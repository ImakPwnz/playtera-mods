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

const SYSMSG = { SMT_BATTLE_SKILL_NEED_WEAPON: 1, SMT_PROHIBITED_ACTION_ON_RIDE: 2, SMT_SKILL_FAIL_CATEGORY: 3, SMT_SKILL_ONLY_DEFENCE_SUCCESS: 4 }
const toClient = [], toServer = []
const connection = {
	metadata: { maps: { protocol: data.maps['302664'], sysmsg: SYSMSG }, protocolVersion: 302664, majorPatchVersion: 46, minorPatchVersion: 5, platform: 'pc', dataFolder: path.join(toolbox, 'data') },
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
		const [pkt, ver] = packetFor(info, typeof c === 'object' ? c : null)
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
			const hold = ['defence', 'movingdefence', 'movingcharge', 'presshit'].includes(info.dcType) || (typeof c === 'object' && c.type && /hold|lockon|charging/.test(c.type))
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
	pvpSperre: pvpTest.faelle,
	fehler: stats.fehler.length, fehlerBeispiele: stats.fehler.slice(0, 25),
	modulAusgaben: process.env.SP_DEBUG ? consoleLog : [...new Set(consoleLog)].slice(0, 20),
}
origLog(JSON.stringify(out, null, 1))
