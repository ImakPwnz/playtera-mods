"""Baut die Skilldaten von Skill Prediction aus den 46.05-Server-Datasheets.

Aufruf: python -I gen46.py <Datasheet-Ordner> <Ausgabeordner> [--fallback a.json ...] [--ref vergleich.json]
  --fallback  skills.json älterer Ports (Reihenfolge = Vorrang); liefert Länge/Strecke nur dort,
              wo die Animation in AnimationData.xml fehlt.
  --ref       nur Abgleich/Statistik.
"""
import glob, json, math, os, re, sys, collections
import xml.etree.ElementTree as ET

DS, OUT = sys.argv[1], sys.argv[2]
REF, FALLBACK = None, []
_a = sys.argv[3:]
while _a:
    opt = _a.pop(0)
    if opt == '--ref':
        REF = _a.pop(0)
    elif opt == '--fallback':
        FALLBACK.append(_a.pop(0))
    elif opt == '--with-common':
        pass
    else:
        REF = opt
FILE_RE = re.compile(r'^UserSkillData_([A-Za-z]+)_([A-Za-z]+)_([MF])\.xml$')


def f(v, d=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return d


def i(v, d=0):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return d


def r2(x):
    return round(x + 1e-9, 2)


# ------------------------------------------------------------------ Animationen
CLIENT = os.path.isdir(os.path.join(DS, 'SkillData'))  # novadrop-Export des Client-DataCenters


def parse(path):
    root = ET.parse(path).getroot()
    for el in root.iter():  # Namensraum entfernen
        if '}' in el.tag:
            el.tag = el.tag.split('}', 1)[1]
    return root


anims = {}
animFiles = glob.glob(os.path.join(DS, 'AnimationData', '*.xml')) if CLIENT else [os.path.join(DS, 'AnimationData.xml')]
for af in animFiles:
    for s in parse(af):
        for a in s:
            anims[(s.get('name'), a.get('name'))] = {
                'dur': i(a.get('animDuration')),
                'root': a.get('rootMotion') in ('1', 'true'),
                'dist': f(a.get('moveDistance', a.get('moveDistance7'))),
                'dir': i(a.get('moveDir')),
            }

stats = collections.Counter()
missingAnims = collections.Counter()


def animSeqInfo(q):
    """(dauer_ms | None, strecke) einer AnimSeq. None = Dauer unbekannt."""
    a = anims.get((q.get('animSet'), q.get('animName')))
    rate = f(q.get('animRate'), 1.0) or 1.0
    dur = i(q.get('duration'))
    if dur < 0:  # Endlosschleife (z. B. Dash)
        return None, 0.0, 'loop'
    if dur == 0:
        if not a:
            missingAnims[(q.get('animSet'), q.get('animName'))] += 1
            return None, 0.0, 'missing'
        dur = a['dur'] / rate
    dist = 0.0
    if a and a['root']:
        dist = a['dist'] * f(q.get('rootMotionXYRate'), 1.0)
    return dur, dist, None


def build(sk):
    tr = f(sk.get('timeRate'), 1.0) or 1.0
    e = {
        'category': [i(c) for c in (sk.get('category') or '0').split(',') if c.strip() != ''],
        'dcType': (sk.get('type') or '').lower(),
        'timeRate': tr,
    }
    if sk.get('needWeapon') == 'false':
        e['noWeapon'] = True
    if sk.get('ignoreAttackSpeed') == 'true':
        e['fixedSpeed'] = True
    for a in ('useSkillWhileAirReaction', 'useSkillWhileBulldozer', 'useSkillWhileReaction'):
        if sk.get(a) == 'true':
            e[a] = True

    act = sk.find('Action')
    if act is None:
        return e, 'noaction'
    stages = act.find('StageList')
    stages = list(stages) if stages is not None else []
    first = stages[0].find('Property') if stages else None
    if first is not None and first.get('skillPendingType') not in (None, '', 'normal'):
        e['skillPendingType'] = first.get('skillPendingType')

    pend = act.find('Pending')
    if pend is not None:
        st = i(pend.get('startTime'))
        if st > 0:
            e['pendingStartTime'] = math.floor(st / tr)
        en = i(pend.get('endTime'))
        if en > 0:
            e['pendingEndTime'] = math.floor(en / tr)
    cancel = act.find('Cancel')
    moveCancel = -1
    if cancel is not None:
        rc = i(cancel.get('rearCancelStartTime'))
        if rc > 0:
            e['rearCancelStartTime'] = math.floor(rc / tr)
        fc = i(cancel.get('frontCancelEndTime'))
        if fc > 0:
            e['frontCancelEndTime'] = math.floor(fc / tr)
        moveCancel = i(cancel.get('moveCancelStartTime'), -1)

    # Zeit und Strecke je Stufe
    lens, dists, problem = [], [], None
    for st in stages:
        total, dist = 0.0, 0.0
        for q in st.findall('AnimSeq'):
            d, m, p = animSeqInfo(q)
            if p:
                problem = problem or p
                total = None
                dist += m
                continue
            if total is not None:
                total += d
            dist += m
        lens.append(total)
        dists.append(r2(dist))

    timeless = e['dcType'] in ('notimeline', 'dash', 'projectile', 'userslug', 'movingcharge', 'defence', 'presshit', 'drain')
    need = None  # 'length' = Länge über Rückfalldaten ergänzen
    charge = [round(f(c.get('duration'))) for c in sk.iter('ChargeStage')]
    if e['dcType'] == 'movingcharge' and charge:
        # Ladestufen ohne die letzte (Überladung); der Kern rechnet timeRate selbst ein
        if len(charge) > 1:
            charge = charge[:-1]
        e['length'] = charge[0] if len(charge) == 1 else charge
        if dists and any(dists):
            e['distance'] = dists[0] if len(dists) == 1 else dists
    elif len(stages) <= 1:
        known = bool(lens) and lens[0] is not None and lens[0] > 0
        if known:
            L = lens[0] / tr - 100
            if moveCancel > 0:
                L = min(moveCancel / tr, L)
            e['length'] = round(L)
        elif not timeless and stages:
            need = 'length'
            if moveCancel > 0:
                e['_mcLength'] = round(moveCancel / tr)
        if dists and dists[0]:
            e['distance'] = dists[0]
        elif problem == 'missing':
            need = need or 'distance'
    else:
        if any(x is None for x in lens):
            if not timeless:
                need = 'length'
        else:
            arr = [round(x / tr) for x in lens]
            if moveCancel > 0:  # letzte Stufe endet beim Bewegungsabbruch
                arr[-1] = max(0, round(moveCancel / tr) - sum(arr[:-1]))
            else:
                arr[-1] = max(0, arr[-1] - 100)
            e['length'] = arr
        if any(dists):
            e['distance'] = dists

    # Ketten aus den Daten
    cc = {}
    for t in ('AddConnectSkill', 'ConnectPrevSkill'):
        for c in sk.iter(t):
            k, v = c.get('categoryCondition'), i(c.get('redirectSkill'))
            if k and v:
                cc.setdefault(k, v)
    if cc:
        e['categoryChains'] = cc
    ac = {}
    for c in sk.iter('AddAbnormalityConnectSkill'):
        k, v = c.get('abnormalityId'), i(c.get('redirectSkill'))
        if k and v:
            ac.setdefault(k, v)
    if ac:
        e['abnormalChains'] = ac
    return e, need


# ------------------------------------------------------------------ Skills
FB = [(os.path.basename(os.path.dirname(os.path.dirname(x))) or x, json.load(open(x, encoding='utf-8'))) for x in FALLBACK]
skills, skipped = {}, collections.defaultdict(list)
files = sorted(glob.glob(os.path.join(DS, 'SkillData', '*.xml')) if CLIENT else glob.glob(os.path.join(DS, 'UserSkillData_*.xml')))
for path in files:
    name = os.path.basename(path)
    common = name.startswith('UserSkillData_Common')
    if not CLIENT and not common and not FILE_RE.match(name):
        continue
    root = parse(path)
    if CLIENT and root.get('huntingZoneId') != '0':
        continue
    for sk in root.iter('Skill'):
        tpl = '9999' if common else str(sk.get('templateId') or root.get('templateId'))
        if CLIENT and not re.match(r'^1\d{4}$', tpl):
            continue
        sid = str(i(sk.get('id')))
        if common:
            skills.setdefault(tpl, {})[sid] = {'category': [0], 'dcType': (sk.get('type') or '').lower(), 'timeRate': f(sk.get('timeRate'), 1.0)}
            continue
        e, need = build(sk)
        if need:
            src = None
            for name, fb in FB:
                o = fb.get(tpl, {}).get(sid)
                if o and o.get('length') is not None and (need == 'distance' or o.get('timeRate') in (None, e['timeRate'])):
                    src = (name, o)
                    break
            if src:
                if need == 'length' or 'length' not in e:
                    e['length'] = src[1]['length']
                if 'distance' not in e and src[1].get('distance'):
                    e['distance'] = src[1]['distance']
                stats['rueckfall:' + src[0]] += 1
            elif need == 'length' and '_mcLength' in e:
                e['length'] = e['_mcLength']
                stats['moveCancel'] += 1
            elif need == 'length':
                stats['ohne_laenge'] += 1
                skipped[tpl].append(sid)
                continue  # keine Vorhersage – der Server bleibt maßgeblich
            else:
                stats['ohne_strecke'] += 1
        else:
            stats['ok'] += 1
            e['x'] = 1  # Länge/Strecke vollständig aus den 46.05-Serverdaten
        e.pop('_mcLength', None)
        skills.setdefault(tpl, {})[sid] = e

os.makedirs(OUT, exist_ok=True)
if '--with-common' not in sys.argv:
    skills.pop('9999', None)  # allgemeine Skills werden vom Modul nicht benutzt
with open(os.path.join(OUT, 'skills.json'), 'w', encoding='utf-8') as fh:
    json.dump(skills, fh, separators=(',', ':'))

json.dump({k: v for k, v in skipped.items()}, open(os.path.join(OUT, 'ohne_vorhersage.json'), 'w', encoding='utf-8'))
print('Skills:', dict(stats))
print('Vorlagen:', len(skills), 'Einträge:', sum(len(v) for v in skills.values()))
print('Fehlende Animationen (Top 15):', missingAnims.most_common(15))

# ------------------------------------------------------------------ Abgleich mit Patch 100
if REF:
    ref = json.load(open(REF, encoding='utf-8'))
    cmp = collections.defaultdict(lambda: [0, 0])
    bad = collections.defaultdict(list)
    for tpl, ss in skills.items():
        if tpl == '9999' or tpl not in ref:
            continue
        for sid, e in ss.items():
            o = ref[tpl].get(sid)
            if not o:
                continue
            for k in ('length', 'distance', 'pendingStartTime', 'rearCancelStartTime', 'frontCancelEndTime', 'timeRate', 'dcType'):
                if k in o or k in e:
                    a, b = e.get(k), o.get(k)
                    if isinstance(a, list) or isinstance(b, list):
                        ok = a == b or (isinstance(a, list) and isinstance(b, list) and len(a) == len(b) and all(abs((x or 0) - (y or 0)) <= 2 for x, y in zip(a, b)))
                    elif isinstance(a, (int, float)) and isinstance(b, (int, float)):
                        ok = abs(a - b) <= 2
                    else:
                        ok = a == b
                    cmp[k][0 if ok else 1] += 1
                    if not ok and len(bad[k]) < 6:
                        bad[k].append((tpl, sid, e.get('dcType'), a, b))
    for k, (ok, no) in cmp.items():
        print(f'  {k:22s} gleich {ok:6d}  abweichend {no:6d}  ({100 * ok / max(1, ok + no):.1f} %)')
        for x in bad[k]:
            print('      ', x)


# ------------------------------------------------------------------ Passivitäten (Glyphen, Ausrüstung)
if not CLIENT:
    passivity = {}
    for path in sorted(glob.glob(os.path.join(DS, 'Passivity_*.xml'))):
        for p in parse(path).iter('Passive'):
            cc = i(p.get('conditionCategory'))
            if cc:
                v = f(p.get('value'))
                passivity[p.get('id')] = {'conditionCategory': cc, 'type': i(p.get('type')), 'method': i(p.get('method')),
                                          'value': int(v) if v == int(v) else v}
    with open(os.path.join(OUT, 'passivity.json'), 'w', encoding='utf-8') as fh:
        json.dump(passivity, fh, separators=(',', ':'))
    print('Passivitäten mit Skillkategorie:', len(passivity))
