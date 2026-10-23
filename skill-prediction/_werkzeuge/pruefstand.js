'use strict'
// Prüfstand für Skill Prediction 46.05 – ohne Spielclient, mit der echten Dispatch-Klasse der Toolbox.
// Aufruf: node pruefstand.js <Toolbox-Ordner> <Modul-Ordner>
// Prüft: alle Hooks/Pakete gegen Opcodes + Definitionen 46.05, Serialisierung jedes gesendeten Pakets,
//        Ablauf (Vorhersage, Ende, Server-Pakete verschluckt) für jeden konfigurierten Skill aller Vorlagen.
const path = require('path'), fs = require('fs')
const [toolbox, modDir] = process.argv.slice(2).map(p => path.resolve(p))

// ---------------------------------------------------------------- virtuelle Uhr
let now = 1e12
const timers = new Map()
let timerSeq = 1
Date.now = () => now
global.setTimeout = (cb, ms, ...args) => { const id = timerSeq++; timers.set(id, { at: now + Math.max(1, Number(ms) || 0), cb, args }); return id }
global.clearTimeout = id => { timers.delete(id) }
global.setInterval = (cb, ms) => { const id = timerSeq++; const tick = () => { timers.set(id, { at: now + ms, cb: () => { cb(); tick() }, args: [] }) }; tick(); return id }
global.clearInterval = global.clearTimeout
function advance(ms) {
	const end = now + ms
	for (;;) {
		let next = null
		for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next[1].at)) next = [id, t]
		if (!next) break
		timers.delete(next[0]); now = next[1].at; next[1].cb(...next[1].args)
	}
	now = end
}

// ---------------------------------------------------------------- Toolbox-Dispatch
global.TeraProxy = { DevMode: false }
const tbModules = path.join(toolbox, 'node_modules')
module.paths.unshift(tbModules)
process.env.NODE_PATH = tbModules; require('module').Module._initPaths()

const errors = []
const logger = require(path.join(tbModules, 'tera-network-proxy', 'lib', 'logger.js'))
logger.error = (...a) => { errors.push(a.join(' ')) }
const Dispatch = require(path.join(tbModules, 'tera-network-proxy', 'lib', 'connection', 'dispatch.js'))
const { SkillID, Vec3 } = require('tera-data-parser').types
const data = JSON.parse(fs.readFileSync(path.join(toolbox, 'data', 'data.json')))
// Ohne PlayTera-Toolbox (keine Opcode-Tabelle 302664) bekommt jedes Paket einen Ersatz-Opcode: dann wird nur der
// Ablauf geprüft, nicht die echten Opcodes (steht im Ergebnis unter "opcodes").
let opcodes = 'PlayTera 46.05'
let protocolMap = data.maps && data.maps['302664']
if (!protocolMap) {
	opcodes = 'ERSATZ (keine 46.05-Tabelle in der Toolbox, nur Ablaufprüfung)'
	protocolMap = {}
	Object.keys(data.protocol).map(f => f.split('.')[0]).sort().forEach((n, i) => { protocolMap[n] = 1000 + i })
}

const SYSMSG = { SMT_BATTLE_SKILL_NEED_WEAPON: 1, SMT_PROHIBITED_ACTION_ON_RIDE: 2, SMT_SKILL_FAIL_CATEGORY: 3, SMT_SKILL_ONLY_DEFENCE_SUCCESS: 4 }
const toClient = [], toServer = []
const connection = {
	metadata: { maps: { protocol: protocolMap, sysmsg: SYSMSG }, protocolVersion: 302664, majorPatchVersion: 46, minorPatchVersion: 5, platform: 'pc', dataFolder: path.join(toolbox, 'data') },
	session: { hasPadding() { return false } }, // neuere Dispatch-Versionen fragen das Padding je Opcode ab
	sendClient(buf) { toClient.push(buf) },
	sendServer(buf) { toServer.push(buf) },
}
const dispatch = new Dispatch(connection)

// ---------------------------------------------------------------- Mod-Schnittstelle (wie bin/mod.js, NetworkModInterface)
const settings = JSON.parse(fs.readFileSync(path.join(modDir, 'settings.json'))).data
const usedHooks = new Set(), usedSends = new Set()
const mod = {
	info: { name: 'skill-prediction' }, settings, dispatch,
	get majorPatchVersion() { return 46 }, get minorPatchVersion() { return 5 },
	command: { add() {}, message(m) { messages.push(m) } },
	log: (...a) => console.log('[mod]', ...a), warn: (...a) => console.log('[mod warn]', ...a), error: (...a) => errors.push(a.join(' ')),
	hook(...args) { usedHooks.add(args[0] + '.' + args[1]); return dispatch.hook('skill-prediction', ...args) },
	unhook(h) { return dispatch.unhook(h) },
	toClient(...a) { usedSends.add(a[0] + '.' + a[1]); return dispatch.write(false, ...a) },
	toServer(...a) { if (typeof a[0] === 'string') usedSends.add(a[0] + '.' + a[1]); return dispatch.write(true, ...a) },
	send(name, version, d) { usedSends.add(name + '.' + version); return dispatch.write(name[0] === 'C', name, version, d) },
	setTimeout: (cb, ms, ...a) => setTimeout(cb, ms, ...a), clearTimeout: id => clearTimeout(id),
	setInterval: (cb, ms) => setInterval(cb, ms), clearInterval: id => clearInterval(id),
	buildSystemMessage: (...a) => dispatch.buildSystemMessage(...a), parseSystemMessage: (...a) => dispatch.parseSystemMessage(...a),
}
const messages = []

// ---------------------------------------------------------------- Modul laden
const result = { hooks: [], ladefehler: null }
let consoleLog = []
const origLog = console.log
console.log = (...a) => consoleLog.push(a.join(' '))
try {
	require(path.join(modDir, 'lib'))(mod)
} catch (e) { result.ladefehler = e.stack }
// Ausgaben des Moduls bleiben bis zum Ende abgefangen
if (result.ladefehler) { origLog('LADEFEHLER', result.ladefehler); process.exit(1) }

// ---------------------------------------------------------------- Pakete
const names = n => n.map(b => dispatch.protocolMap.code.get(b.readUInt16LE(2)))
function server(name, version, obj) { // Server -> Client
	const buf = dispatch.protocol.write(dispatch.protocol.resolveIdentifier(name, version), obj)
	const r = dispatch.handle(buf, true, false)
	return r !== false
}
function client(name, version, obj) { // Client -> Server
	const buf = dispatch.protocol.write(dispatch.protocol.resolveIdentifier(name, version), obj)
	const r = dispatch.handle(buf, false, false)
	if (r !== false) toServer.push(r)
	return r !== false
}
function parseOut(buf) {
	const name = dispatch.protocolMap.code.get(buf.readUInt16LE(2))
	const v = dispatch.latestDefVersion.get(name)
	return { name, ev: v ? dispatch.protocol.parse(dispatch.protocol.resolveIdentifier(name, v), buf) : null }
}

// Paketgrößen von C_PLAYER_LOCATION v4/v5 (Grundlage der Längenerkennung)
const locSizes = {}
for (const v of [4, 5]) locSizes[v] = dispatch.protocol.write(dispatch.protocol.resolveIdentifier('C_PLAYER_LOCATION', v), { loc: new Vec3(0, 0, 0), dest: new Vec3(0, 0, 0) }).length

// ---------------------------------------------------------------- Ablauf je Vorlage und Skill
const skillsData = JSON.parse(fs.readFileSync(path.join(modDir, 'config', 'skills.json')))
const cfg = require(path.join(modDir, 'config', 'skills.js'))
const stats = { dgBeispiele: [], zeitGeprueft: 0, zeitAbweichung: [], vorlagen: 0, skills: 0, vorhergesagt: 0, durchgereicht: 0, ohneEnde: [], endeAbweichung: [], fehler: [] }
const GAME_ID = 0x1234n
let pos = new Vec3(1000, 1000, 100)

// "change"-Skills (46.05) sind reine Umleiter: Paketart und Haltetyp richten sich nach dem Ziel aus `changeDefault`
function resolveChange(ss, id, info, cfgEntry) {
	if (info.dcType !== 'change' || !cfgEntry || cfgEntry.changeDefault == null) return [id, info]
	const target = cfgEntry.changeDefault > 99 ? cfgEntry.changeDefault : id - id % 100 + cfgEntry.changeDefault
	return ss[target] ? [target, ss[target]] : [id, info]
}
function packetFor(info, cfgEntry) {
	if (cfgEntry && (cfgEntry.type === 'lockon' || cfgEntry.type === 'lockonCast')) return ['C_START_TARGETED_SKILL', 6]
	switch (info.dcType) {
		case 'instance': return ['C_START_INSTANCE_SKILL', 5]
		case 'combo_instance': return ['C_START_COMBO_INSTANT_SKILL', 4]
		case 'notimeline': return ['C_NOTIMELINE_SKILL', 3]
		case 'defence': case 'movingdefence': case 'movingcharge': case 'presshit': return ['C_PRESS_SKILL', 4]
		default: return ['C_START_SKILL', 7]
	}
}
function startPacket(name, skill) {
	const s = new SkillID({ id: skill, type: 1 })
	switch (name) {
		case 'C_START_SKILL': return { skill: s, w: 0, loc: pos, dest: pos.addN({ x: 100 }), unk: true, moving: false, continue: false, target: 0n }
		case 'C_START_TARGETED_SKILL': return { skill: s, loc: pos, w: 0, dest: pos, targets: [{ id: 0x5555n }] }
		case 'C_START_INSTANCE_SKILL': return { skill: s, loc: pos, w: 0, unk: false, targets: [{ unk1: 0, target: 0x5555n }], endpoints: [{ loc: pos.addN({ x: 50 }) }] }
		case 'C_START_COMBO_INSTANT_SKILL': return { skill: s, loc: pos, w: 0, targets: [{ unk1: 0, target: 0x5555n }], endpoints: [{ loc: pos.addN({ x: 50 }) }] }
		case 'C_NOTIMELINE_SKILL': return { skill: s }
		case 'C_PRESS_SKILL': return { skill: s, press: true, loc: pos, w: 0 }
	}
}
function cfgFor(job, id) {
	const g = Math.floor(id / 10000), sub = id % 100
	const c = cfg[job] && cfg[job][g]
	return c ? (c[sub] !== undefined ? c[sub] : undefined) : undefined
}

if (process.env.SP_DEBUG) settings.debug.skills = true
for (const [tpl, ss] of Object.entries(skillsData)) {
	if (process.env.SP_TPL && tpl !== process.env.SP_TPL) continue
	const job = Number(tpl) % 100 - 1
	if (!cfg[job]) continue
	stats.vorlagen++
	server('S_LOGIN', 12, { templateId: Number(tpl), gameId: GAME_ID, alive: true, level: 65 })
	server('S_SPAWN_ME', 3, { gameId: GAME_ID, loc: pos, w: 0, alive: true })
	server('S_PLAYER_STAT_UPDATE', 12, { attackSpeed: 100, attackSpeedBonus: 20, stamina: 5000, staminaMax: 5000 })
	server('S_INVEN', 18, { gameId: GAME_ID, first: true, more: false, items: [{ id: 10001, slot: 1, amount: 1, passivities: [] }] })
	server('S_CREST_INFO', 2, { crests: [] })

	// je Gruppe/Unter-ID die niedrigste Stufe testen
	const seen = new Set()
	for (const id of Object.keys(ss).map(Number).sort((a, b) => a - b)) {
		const key = Math.floor(id / 10000) + '-' + (id % 100)
		if (seen.has(key)) continue
		seen.add(key)
		const c = cfgFor(job, id)
		if (!c) continue
		stats.skills++
		const info = ss[id]
		const [, target] = resolveChange(ss, id, info, typeof c === 'object' ? c : null)
		const [pkt, ver] = packetFor(target, typeof c === 'object' ? c : null)
		toClient.length = 0; toServer.length = 0
		const errBefore = errors.length
		client(pkt, ver, startPacket(pkt, id))
		if (!toClient.length) advance(60) // Start kann per Jitter-Kompensation leicht verzögert sein
		const sent = toClient.map(parseOut)
		const stage = sent.find(p => p.name === 'S_ACTION_STAGE')
		if (stage) {
			stats.vorhergesagt++
			// Ende abwarten (max. 15 s virtuell)
			// Server bestätigt nach 30 ms (Ping) – muss verschluckt werden
			advance(30)
			const fw = server('S_ACTION_STAGE', 9, { gameId: GAME_ID, loc: pos, w: 0, templateId: Number(tpl), skill: new SkillID({ id, type: 1 }), stage: 0, speed: 1.2, id: 77, effectScale: 1, animSeq: [] })
			let ended = null, dt = 30
			for (; dt < 40000 && !ended; dt += 10) {
				advance(10)
				ended = toClient.map(parseOut).find(p => p.name === 'S_ACTION_END')
			}
			// Zeitpunkt prüfen: einstufige Skills ohne Konfig-Sonderlogik, Tempo 1,2 (Grundwert 100 + 20 Bonus)
			const simple = typeof info.length === 'number' && !info.fixedSpeed && (c === true) && ['normal', 'combo', 'evade', 'connect', 'switch', 'stand', 'movingskill', 'instance', 'combo_instance'].includes(info.dcType)
			if (ended && simple) {
				const speed = job >= 8 ? 1.2 : 1.2
				const exp = Math.round(info.length / speed)
				stats.zeitGeprueft++
				if (Math.abs(dt - (exp + 30)) > 10) stats.zeitAbweichung.push(`${tpl} ${id} ${info.dcType}: Ende nach ${dt} ms, erwartet ${exp} ms`)
			}
			const hold = ['defence', 'movingdefence', 'movingcharge', 'presshit'].includes(target.dcType) || (typeof c === 'object' && c.type && /hold|lockon|charging/.test(c.type))
			if (!ended && !hold) stats.ohneEnde.push(`${tpl} ${id} ${info.dcType}`)
			// Server bestätigt: muss verschluckt werden
			const fe = server('S_ACTION_END', 5, { gameId: GAME_ID, loc: pos, w: 0, templateId: Number(tpl), skill: new SkillID({ id, type: 1 }), type: 0, id: 77 })
			if (fw || fe) stats.endeAbweichung.push(`${tpl} ${id}: Serverpaket nicht verschluckt (stage ${fw}, end ${fe})`)
			// Aufräumen wie im Spiel nach Laden/Teleport
			server('S_LOAD_TOPO', 3, { zone: 1, loc: pos, quick: true })
			advance(45000)
		} else { stats.durchgereicht++; if (stats.dgBeispiele.length < 3000) stats.dgBeispiele.push(`${tpl} ${id} ${info.dcType} -> ${sent.map(p => p.name).join(',') || 'nichts'}`) }
		if (!toServer.length && stage) stats.fehler.push(`${tpl} ${id}: Startpaket nicht an den Server weitergeleitet`)
		for (const e of errors.slice(errBefore)) stats.fehler.push(`${tpl} ${id}: ${e.split('\n').slice(0, 4).join(' | ')}`)
	}
}

// ---------------------------------------------------------------- 46.05-Mechaniken (Brawler/Ninja): Umleiter, Buff-Ketten, Haltetasten
// Jeder Fall: Vorlage anmelden, Buffs setzen, ggf. Vorgängerskill starten, Skill starten und die vorhergesagte ID prüfen.
const mech = { faelle: [], fehler: [] }
{
	function login(tpl) {
		server('S_LOGIN', 12, { templateId: Number(tpl), gameId: GAME_ID, alive: true, level: 65 })
		server('S_SPAWN_ME', 3, { gameId: GAME_ID, loc: pos, w: 0, alive: true })
		server('S_PLAYER_STAT_UPDATE', 12, { attackSpeed: 100, attackSpeedBonus: 20, stamina: 5000, staminaMax: 5000 })
		server('S_INVEN', 18, { gameId: GAME_ID, first: true, more: false, items: [{ id: 10001, slot: 1, amount: 1, passivities: [] }] })
		server('S_CREST_INFO', 2, { crests: [] })
		server('S_LOAD_TOPO', 3, { zone: 9999, loc: pos, quick: true }); advance(100)
	}
	function buff(id) { server('S_ABNORMALITY_BEGIN', 3, { target: GAME_ID, source: GAME_ID, id, duration: 600000, unk: 0, stacks: 1, unk2: 0 }) }
	function unbuff(id) { server('S_ABNORMALITY_END', 1, { target: GAME_ID, id }) }
	function stageIds() { return toClient.map(parseOut).filter(p => p.name === 'S_ACTION_STAGE').map(p => p.ev.skill.id) }
	function endTypes() { return toClient.map(parseOut).filter(p => p.name === 'S_ACTION_END').map(p => p.ev.type) }
	function start(id, pkt = 'C_START_SKILL', ver = 7, obj) { toClient.length = 0; toServer.length = 0; const fw = client(pkt, ver, obj || startPacket(pkt, id)); if (!toClient.length) advance(60); return fw }
	function reset() { server('S_LOAD_TOPO', 3, { zone: 9999, loc: pos, quick: true }); advance(45000) }
	function fall(name, erwartet, ist) {
		const ok = JSON.stringify(erwartet) === JSON.stringify(ist)
		mech.faelle.push(`${ok ? 'OK ' : 'FEHLER'} ${name}: erwartet ${JSON.stringify(erwartet)}, ist ${JSON.stringify(ist)}`)
		if (!ok) mech.fehler.push(name)
	}
	// ---- Brawler 10211
	if (skillsData['10211'] && cfg[10]) {
		login('10211')
		start(60100); fall('Brawler Umleiter 60100 ohne Growing Fury -> 60101', [60101], stageIds()); reset()
		buff(10153002); start(60100); fall('Brawler Umleiter 60100 mit Growing Fury -> 60102', [60102], stageIds()); reset(); unbuff(10153002)
		// Umleiter + Kette: nach einem Brawler-Angriff (Kategorie 800) führt 60101 weiter zu 60130
		start(70100); fall('Brawler 70100 aus dem Stand', [70100], stageIds())
		start(60100); fall('Brawler 60100 während 70100 -> 60130 (Kette über 800)', [60130], stageIds()); reset()
		// Punch-Kombo: 10100 -> 10101 -> 10102 -> 10103 -> 10100
		const combo = []
		for (let i = 0; i < 5; i++) { start(10100); combo.push(...stageIds()) }
		fall('Brawler Punch-Kombo', [10100, 10101, 10102, 10103, 10100], combo); reset()
		// Punch nach anderem Skill = 10130, keine Kaskade zu 10101
		start(70100); start(10100); fall('Brawler Punch nach 70100 -> 10130 (keine Kaskade)', [10130], stageIds()); reset()
		buff(10153003); start(10100); fall('Brawler Punch mit Growing Fury 3 -> 10131', [10131], stageIds()); reset(); unbuff(10153003)
		// Counter: Drücken -> 20110 (Halten), Server bestätigt 20110, Loslassen mit Basis-ID 20100 -> S_ACTION_END 51
		start(20100, 'C_PRESS_SKILL', 4); fall('Brawler Counter drücken -> 20110', [20110], stageIds())
		advance(30)
		const fw1 = server('S_ACTION_STAGE', 9, { gameId: GAME_ID, loc: pos, w: 0, templateId: 10211, skill: new SkillID({ id: 20110, type: 1 }), stage: 0, speed: 1, id: 91, effectScale: 1, animSeq: [] })
		fall('Brawler Counter Serverbestätigung verschluckt', false, fw1)
		advance(500); toClient.length = 0
		const fwRel = client('C_PRESS_SKILL', 4, { skill: new SkillID({ id: 20100, type: 1 }), press: false, loc: pos, w: 0 })
		fall('Brawler Counter loslassen -> S_ACTION_END 51, Paket weitergeleitet', [[51], true], [endTypes(), fwRel])
		const fe1 = server('S_ACTION_END', 5, { gameId: GAME_ID, loc: pos, w: 0, templateId: 10211, skill: new SkillID({ id: 20110, type: 1 }), type: 51, id: 91 })
		fall('Brawler Counter Server-Ende verschluckt', false, fe1); reset()
		buff(10153001); start(20100, 'C_PRESS_SKILL', 4); fall('Brawler Counter mit Growing Fury -> 20111', [20111], stageIds()); reset(); unbuff(10153001)
		// Nach perfektem Block (10153060) bleibt der Server zuständig, seine Ablehnung muss durchkommen
		buff(10153060); const fwC = start(20100, 'C_PRESS_SKILL', 4)
		fall('Brawler Counter mit 10153060: nicht vorhergesagt, weitergeleitet', [[], true], [stageIds(), fwC])
		const fwCannot = server('S_CANNOT_START_SKILL', 4, { skill: new SkillID({ id: 20100, type: 1 }) })
		fall('Brawler Counter mit 10153060: S_CANNOT_START_SKILL kommt durch', true, fwCannot); unbuff(10153060); reset()
		// Nicht konfigurierte Gruppen gehen unverändert an den Server
		const fwD = start(170100); fall('Brawler Dash 170100 nicht vorhergesagt', [[], true], [stageIds(), fwD]); reset()
	}
	// ---- Ninja 11012
	if (skillsData['11012'] && cfg[11]) {
		login('11012')
		start(10100); fall('Ninja Kombo ohne Chi -> 10100', [10100], stageIds()); reset()
		buff(10154001); start(10100); fall('Ninja Kombo mit Chi 10154001 -> 10102', [10102], stageIds()); reset(); unbuff(10154001)
		start(30100); start(10100); fall('Ninja Kombo nach 30100 -> 10130', [10130], stageIds()); reset()
		start(130100); fall('Ninja Umleiter 130100 ohne Chi -> 130101', [130101], stageIds()); reset()
		buff(10154003); start(130100); fall('Ninja Umleiter 130100 mit Chi -> 130102', [130102], stageIds()); reset(); unbuff(10154003)
		start(120100); fall('Ninja 120100 (Umleiter mit eigener Animation) ohne Chi bleibt 120100', [120100], stageIds()); reset()
		const fwN = start(40100); fall('Ninja Dash-Gruppe 40100 nicht vorhergesagt', [[], true], [stageIds(), fwN]); reset()
	}
	// ---- Rückwirkung auf bestehende Klassen: Umleiter ohne changeDefault bleiben wie bisher
	if (skillsData['10104'] && cfg[3]) { // Berserker 120100: change mit eigener Animation, bisher vorhergesagt
		login('10104'); start(120100); fall('Berserker 120100 (change mit Animation) weiterhin vorhergesagt', [120100], stageIds()); reset()
	}
	if (skillsData['10410'] && cfg[9]) { // Gunner 10100: change ohne Animation und ohne changeDefault -> Server, Ablehnung kommt durch
		login('10410'); const fwG = start(10100); fall('Gunner 10100 (change ohne Default) nicht vorhergesagt', [[], true], [stageIds(), fwG])
		fall('Gunner 10100: S_CANNOT_START_SKILL kommt durch', true, server('S_CANNOT_START_SKILL', 4, { skill: new SkillID({ id: 10100, type: 1 }) })); reset()
	}
	for (const f of mech.fehler) stats.fehler.push(`46.05-Mechanik: ${f}`)
}

// ---------------------------------------------------------------- PvP-Sperre (Schlachtfeld / PvP-Channel)
// Erwartung: in Schlachtfeld-Kontinenten und auf dem sichtbaren Channel 2 (intern 1) wird nichts vorhergesagt,
// das Startpaket geht unverändert an den Server; sonst (Dungeon ohne S_CURRENT_CHANNEL, Channel 1) wird vorhergesagt.
const pvpTest = { faelle: [], fehler: [] }
{
	const tpl = Object.keys(skillsData).find(t => cfg[Number(t) % 100 - 1]) // erste Vorlage mit Konfiguration
	const job = Number(tpl) % 100 - 1, ss = skillsData[tpl]
	const id = Object.keys(ss).map(Number).sort((a, b) => a - b).find(i => { const c = cfgFor(job, i); return c === true && ss[i].dcType === 'normal' && typeof ss[i].length === 'number' })
	server('S_LOGIN', 12, { templateId: Number(tpl), gameId: GAME_ID, alive: true, level: 65 })
	server('S_SPAWN_ME', 3, { gameId: GAME_ID, loc: pos, w: 0, alive: true })
	server('S_PLAYER_STAT_UPDATE', 12, { attackSpeed: 100, attackSpeedBonus: 20, stamina: 5000, staminaMax: 5000 })
	server('S_INVEN', 18, { gameId: GAME_ID, first: true, more: false, items: [{ id: 10001, slot: 1, amount: 1, passivities: [] }] })
	server('S_CREST_INFO', 2, { crests: [] })
	const faelle = [
		['Dungeon ohne Channel', () => server('S_LOAD_TOPO', 3, { zone: 9999, loc: pos, quick: true }), true],
		['Schlachtfeld 116', () => server('S_LOAD_TOPO', 3, { zone: 116, loc: pos, quick: true }), false],
		['Offene Welt 7001, Channel 1 (intern 0)', () => { server('S_LOAD_TOPO', 3, { zone: 7001, loc: pos, quick: true }); server('S_CURRENT_CHANNEL', 1, { zone: 7001, channel: 0, density: 0 }) }, true],
		['Offene Welt 7001, Channel 2 (intern 1)', () => server('S_CURRENT_CHANNEL', 1, { zone: 7001, channel: 1, density: 0 }), false],
		['Zurück auf Channel 1', () => server('S_CURRENT_CHANNEL', 1, { zone: 7001, channel: 0, density: 0 }), true],
		['Channel 2, dann Dungeon ohne Channel', () => { server('S_CURRENT_CHANNEL', 1, { zone: 7001, channel: 1, density: 0 }); server('S_LOAD_TOPO', 3, { zone: 9999, loc: pos, quick: true }) }, true],
		['Schlachtfeld, Sperre per Einstellung aus', () => { settings.pvp.enabled = false; server('S_LOAD_TOPO', 3, { zone: 116, loc: pos, quick: true }) }, true],
		['Schlachtfeld, Sperre wieder an', () => { settings.pvp.enabled = true; server('S_LOAD_TOPO', 3, { zone: 116, loc: pos, quick: true }) }, false],
		['Ausloggen (S_RETURN_TO_LOBBY) hebt Sperre auf', () => { dispatch.handle(Buffer.from([4, 0, dispatch.protocolMap.name.get('S_RETURN_TO_LOBBY') & 0xff, dispatch.protocolMap.name.get('S_RETURN_TO_LOBBY') >> 8]), true, false); server('S_LOGIN', 12, { templateId: Number(tpl), gameId: GAME_ID, alive: true, level: 65 }); server('S_SPAWN_ME', 3, { gameId: GAME_ID, loc: pos, w: 0, alive: true }); server('S_PLAYER_STAT_UPDATE', 12, { attackSpeed: 100, attackSpeedBonus: 20, stamina: 5000, staminaMax: 5000 }); server('S_INVEN', 18, { gameId: GAME_ID, first: true, more: false, items: [{ id: 10001, slot: 1, amount: 1, passivities: [] }] }); server('S_CREST_INFO', 2, { crests: [] }) }, true],
	]
	for (const [name, setup, erwartetVorhersage] of faelle) {
		const msgBefore = messages.length
		setup(); advance(100)
		toClient.length = 0; toServer.length = 0
		const forwarded = client('C_START_SKILL', 7, startPacket('C_START_SKILL', id))
		if (!toClient.length) advance(60)
		const stage = toClient.map(parseOut).find(p => p.name === 'S_ACTION_STAGE')
		const vorhergesagt = !!stage
		// Serverpakete: bei Sperre müssen sie durchgehen, sonst verschluckt werden
		advance(30)
		const fw = server('S_ACTION_STAGE', 9, { gameId: GAME_ID, loc: pos, w: 0, templateId: Number(tpl), skill: new SkillID({ id, type: 1 }), stage: 0, speed: 1.2, id: 88, effectScale: 1, animSeq: [] })
		advance(5000)
		const fe = server('S_ACTION_END', 5, { gameId: GAME_ID, loc: pos, w: 0, templateId: Number(tpl), skill: new SkillID({ id, type: 1 }), type: 0, id: 88 })
		const ok = vorhergesagt === erwartetVorhersage && (vorhergesagt ? (!fw && !fe) : (fw && fe && forwarded))
		pvpTest.faelle.push(`${ok ? 'OK ' : 'FEHLER'} ${name}: vorhergesagt=${vorhergesagt} serverStage=${fw} serverEnd=${fe} weitergeleitet=${forwarded} hinweise=${messages.slice(msgBefore).map(m => m.replace(/<[^>]+>/g, '')).join(' | ') || '-'}`)
		if (!ok) pvpTest.fehler.push(name)
		advance(45000)
	}
	server('S_LOAD_TOPO', 3, { zone: 1, loc: pos, quick: true })
	for (const f of pvpTest.fehler) stats.fehler.push(`PvP-Sperre: ${f}`)
}

// Hooks/Sends gegen 46.05 prüfen
const check = (set) => [...set].map(k => {
	const [n, v] = k.split('.')
	const op = dispatch.protocolMap.name.get(n)
	if (op === undefined) return `${k}: KEIN OPCODE`
	if (v === 'raw' || v === 'event') return null
	try { dispatch.protocol.resolveIdentifier(n, Number(v)); return null } catch (e) { return `${k}: ${e.message}` }
}).filter(Boolean)

const out = {
	geladen: true,
	hooks: [...usedHooks].sort(), gesendet: [...usedSends].sort(),
	protokollProbleme: [...check(usedHooks), ...check(usedSends)],
	playerLocationGroessen: locSizes,
	vorlagen: stats.vorlagen, getesteteSkills: stats.skills, vorhergesagt: stats.vorhergesagt, durchgereicht: stats.durchgereicht,
	ohneEnde: stats.ohneEnde.length, ohneEndeBeispiele: stats.ohneEnde.slice(0, 15),
	serverNichtVerschluckt: stats.endeAbweichung.length, beispiele: stats.endeAbweichung.slice(0, 10),
	zeitGeprueft: stats.zeitGeprueft, zeitAbweichung: stats.zeitAbweichung.length, zeitBeispiele: stats.zeitAbweichung.slice(0, 10),
	dgBeispiele: stats.dgBeispiele,
	opcodes,
	mechaniken4605: mech.faelle,
	pvpSperre: pvpTest.faelle,
	fehler: stats.fehler.length, fehlerBeispiele: stats.fehler.slice(0, 25),
	modulAusgaben: process.env.SP_DEBUG ? consoleLog : [...new Set(consoleLog)].slice(0, 20),
}
origLog(JSON.stringify(out, null, 1))
