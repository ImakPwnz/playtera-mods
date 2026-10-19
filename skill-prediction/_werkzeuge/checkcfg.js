'use strict'
// Prüft config/skills.js (Klassenkonfiguration) gegen die erzeugten 46.05-Daten und die Abnormality-IDs des Servers.
// Aufruf: node checkcfg.js <config/skills.js> <skills.json> <Datasheet-Ordner>
const fs = require('fs'), path = require('path')
const [cfgPath, dataPath, ds] = process.argv.slice(2)
const cfg = require(path.resolve(cfgPath)), data = JSON.parse(fs.readFileSync(dataPath, 'utf8'))

// Abnormality-IDs
const abn = new Set()
for (const f of fs.readdirSync(ds).filter(f => /^Abnormality(_[A-Z]+)?\.xml$/i.test(f) || /^Abnormality_.*\.xml$/i.test(f))) {
	const s = fs.readFileSync(path.join(ds, f), 'utf8')
	for (const m of s.matchAll(/<Abnormal\s[^>]*?\bid="(\d+)"/g)) abn.add(Number(m[1]))
}

// Skills je Klasse (job = templateId % 100 - 1)
const byJob = {}
for (const [tpl, ss] of Object.entries(data)) {
	if (tpl === '9999') continue
	const job = Number(tpl) % 100 - 1
	byJob[job] = byJob[job] || new Map()
	for (const [id, e] of Object.entries(ss)) {
		const n = Number(id), key = Math.floor(n / 10000) + '-' + (n % 100)
		if (!byJob[job].has(key)) byJob[job].set(key, [])
		byJob[job].get(key).push(e)
	}
}

const out = { fehlendeSkills: [], fehlendeBuffs: [], festeWerte: [], klassen: {} }
const ABN_KEYS = ['requiredBuff', 'consumeAbnormal', 'consumeAbnormalEnd', 'noChargeAbnormalityId']
const ABN_MAPS = ['triggerAbnormal', 'abnormals', 'interruptibleWithAbnormal', 'interruptAllWithAbnormal', 'abnormalChains']

function checkData(where, d) {
	if (!d || typeof d !== 'object') return
	for (const k of ABN_KEYS) if (d[k] !== undefined)
		for (const id of [].concat(d[k])) if (!abn.has(Number(id))) out.fehlendeBuffs.push(`${where} ${k} ${id}`)
	for (const k of ABN_MAPS) if (d[k])
		for (const id of Object.keys(d[k])) if (!abn.has(Number(id))) out.fehlendeBuffs.push(`${where} ${k} ${id}`)
	if (d.race) for (const [r, v] of Object.entries(d.race)) checkData(`${where} race${r}`, v)
	if (d.level) for (const [l, v] of Object.entries(d.level)) checkData(`${where} level${l}`, v)
}

for (const [job, groups] of Object.entries(cfg)) {
	if (job === '*') { for (const [id, d] of Object.entries(groups)) checkData(`*:${id}`, d); continue }
	const have = byJob[job]
	out.klassen[job] = { konfiguriert: 0, vorhanden: 0 }
	for (const [group, subs] of Object.entries(groups)) {
		if (group === '*') { checkData(`${job}:*`, subs); continue }
		for (const [sub, d] of Object.entries(subs)) {
			if (sub === '*') { checkData(`${job}:${group}-*`, d); continue }
			if (!d) continue
			out.klassen[job].konfiguriert++
			const ents = have && have.get(group + '-' + sub)
			if (!ents) { out.fehlendeSkills.push(`${job}:${group}-${sub}`); continue }
			out.klassen[job].vorhanden++
			checkData(`${job}:${group}-${sub}`, d)
			for (const k of ['length', 'distance'])
				if (d && typeof d === 'object' && d[k] !== undefined) {
					const vals = [...new Set(ents.map(e => JSON.stringify(e[k])))]
					if (!(vals.length === 1 && vals[0] === JSON.stringify(d[k])))
						out.festeWerte.push(`${job}:${group}-${sub} ${k} Konfig=${JSON.stringify(d[k])} 46.05=${vals.slice(0, 3).join('|')}`)
				}
		}
	}
}
out.abnormalitiesGesamt = abn.size
console.log(JSON.stringify(out, null, 1))
