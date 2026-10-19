'use strict'
// Erzeugt manifest.json (SHA-256 je Datei) für die Toolbox-Aktualisierung.
// Ausgelassen: settings.json, manifest.json und alles, was mit "." oder "_" beginnt.
const fs = require('fs'), path = require('path'), crypto = require('crypto')
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'))
const skip = new Set(['settings.json', 'manifest.json'])
const files = {}
;(function walk(dir) {
	for (const name of fs.readdirSync(dir).sort()) {
		if (name.startsWith('.') || name.startsWith('_')) continue
		const full = path.join(dir, name), rel = path.relative(root, full).split(path.sep).join('/')
		if (fs.statSync(full).isDirectory()) walk(full)
		else if (!skip.has(rel)) files[rel] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')
	}
})(root)
fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ files }, null, '\t') + '\n')
console.log(`manifest.json: ${Object.keys(files).length} Dateien`)
