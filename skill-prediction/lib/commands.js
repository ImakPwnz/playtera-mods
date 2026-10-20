'use strict'

const subMod = require('./require')

module.exports = function SPCommands(mod) {
	const ping = subMod(mod, './ping'),
		debug = subMod(mod, './debug'),
		core = subMod(mod, './core'),
		pvp = subMod(mod, './pvp')

	mod.command.add('sp', {
		$default() { message(`Unknown command "${this}".`) },
		$none: printHelp,
		help: printHelp,
		ping: printPing,
		reload: doReload,
		debug(type = '') {
			switch(type.toLowerCase()) {
				case 'loc': case 'location':
					message(`Location debug ${(mod.settings.debug.loc = !mod.settings.debug.loc) ? 'enabled' : 'disabled'}.`)
					debug.reload()
					break
				case 'abnormal': case 'abnormals': case 'abnormality': case 'abnormalities':
					message(`Abnormality debug ${(mod.settings.debug.abnormals = !mod.settings.debug.abnormals) ? 'enabled' : 'disabled'}.`)
					debug.reload()
					break
				default:
					message(`Skill debug ${(mod.settings.debug.skills = !mod.settings.debug.skills) ? 'enabled' : 'disabled'}.`)
					debug.reload()
					break
			}
		},
		pvp(what = '', value = '') {
			const s = mod.settings.pvp
			switch(what.toLowerCase()) {
				case '':
				case 'status':
					message(`PvP pause: ${pvp.status()}`)
					return
				case 'on': case 'off':
					s.enabled = what.toLowerCase() === 'on'
					message(`PvP pause ${s.enabled ? 'enabled' : 'disabled'}.`)
					break
				case 'bg': case 'battleground': case 'battlegrounds':
					s.battlegrounds = value.toLowerCase() !== 'off'
					message(`Pause in battlegrounds ${s.battlegrounds ? 'enabled' : 'disabled'}.`)
					break
				case 'channel': case 'channels': case 'ch':
					s.channels = value.toLowerCase() === 'off' ? [] : value.split(',').map(Number).filter(n => Number.isInteger(n) && n > 0)
					message(`Pause on channel(s): ${s.channels.length ? s.channels.join(', ') : 'none'}.`)
					break
				case 'lang': case 'language':
					if(!['en', 'de', 'ru'].includes(value.toLowerCase())) { message('Languages: en, de, ru'); return }
					s.language = value.toLowerCase()
					message(`Notice language: ${s.language}.`)
					break
				default:
					message(`<FONT COLOR="#FFFFFF">pvp</FONT> = status, <FONT COLOR="#FFFFFF">pvp on|off</FONT>, <FONT COLOR="#FFFFFF">pvp bg on|off</FONT>, <FONT COLOR="#FFFFFF">pvp channel 2[,3]|off</FONT>, <FONT COLOR="#FFFFFF">pvp lang en|de|ru</FONT>`)
					return
			}
			pvp.refresh()
		},
		info: printRTFM,
		strictdef: printRTFM,
		mount: printRTFM,
		off: printRTFM,
		on: printRTFM,
		config: printRTFM,
		debugloc: printRTFM,
		debugabnorm: printRTFM
	})

	function printHelp() {
		message(`Commands:
<FONT COLOR="#FFFFFF">ping</FONT> = Display ping statistics.
<FONT COLOR="#FFFFFF">reload</FONT> = Reload skill configuration from disk.
<FONT COLOR="#FFFFFF">debug [skill|loc|abnormal]</FONT> = Toggle debug modes.
<FONT COLOR="#FFFFFF">pvp [on|off|bg|channel|lang]</FONT> = Pause prediction in battlegrounds / on the PvP channel.`)
	}

	function printPing() {
		mod.command.message(`Ping: ${ping.history.length ? `Avg=${Math.round(ping.avg)} Min=${ping.min} Max=${ping.max} Jitter=${ping.max - ping.min} Samples=${ping.history.length}` : '???'}`)
	}

	function doReload() {
		core.reload()
	}

	function message(msg) { mod.command.message(`${msg}`) }

	function printRTFM(msg) {
		message(`SaltyMonkey's public Skill-Prediction fork has been discontinued.
You are now using Pinkie Pie's SP which doesn't support the command you tried.
For feedback please contact Pinkie Pie on Discord.`)
	}
}