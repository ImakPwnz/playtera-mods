'use strict'

// PvP gate: pauses skill prediction in battlegrounds and on the open-world PvP channel.
// Prediction emulates skills before the server confirms them; against other players this shows as desync,
// so the core asks `suspended` and treats every skill as unemulated while it is true.
//
// Zone  = continent id from S_LOAD_TOPO / S_CURRENT_CHANNEL (same ids as ContinentData.xml).
// Channel = the value in S_CURRENT_CHANNEL is the server's internal index (0-based); players see index + 1.
//           PlayTera's PvP channel is displayed as "Channel 2" = internal 1. Settings use the displayed number.

const BATTLEGROUNDS = new Set(require('../config/battlegrounds.json').continents)

const TEXT = {
	en: {
		battleground: 'paused in battleground (desync protection)',
		channel: n => `paused on channel ${n} (PvP)`,
		resumed: 'active again',
		disabled: 'PvP pause is off, prediction stays active everywhere'
	},
	de: {
		battleground: 'im Schlachtfeld pausiert (Desync-Schutz)',
		channel: n => `auf Channel ${n} (PvP) pausiert`,
		resumed: 'wieder aktiv',
		disabled: 'PvP-Pause ist aus, Vorhersage bleibt überall aktiv'
	},
	ru: {
		battleground: 'приостановлена на поле боя (защита от рассинхрона)',
		channel: n => `приостановлена на канале ${n} (PvP)`,
		resumed: 'снова активна',
		disabled: 'PvP-пауза выключена, предсказание активно везде'
	}
}

module.exports = function PvpGate(mod) {
	let zone = 0,
		channel = -1, // internal index, -1 = unknown (no S_CURRENT_CHANNEL since the last zone load)
		suspended = false,
		reason = null, // 'battleground' | 'channel'
		listeners = []

	const settings = () => mod.settings.pvp || {}

	function text() { return TEXT[settings().language] || TEXT.en }

	function displayedChannel() { return channel + 1 }

	function evaluate(announce = true) {
		const s = settings()
		let next = null

		if(s.enabled !== false) {
			if(s.battlegrounds !== false && BATTLEGROUNDS.has(zone)) next = 'battleground'
			else if(channel >= 0 && Array.isArray(s.channels) && s.channels.includes(displayedChannel())
				&& !(Array.isArray(s.channelZones) && s.channelZones.length && !s.channelZones.includes(zone))) next = 'channel'
		}

		if(next === reason) return
		suspended = !!next
		reason = next

		for(let cb of listeners) cb(suspended, reason)

		if(announce && s.notify !== false) {
			const t = text()
			notify(reason === 'battleground' ? t.battleground : reason === 'channel' ? t.channel(displayedChannel()) : t.resumed)
		}
	}

	function notify(msg) {
		mod.command.message(`<font color="${suspended ? '#ffcc66' : '#aaffaa'}">[Skill Prediction] ${msg}</font>`)
	}

	function reset() {
		zone = 0
		channel = -1
		evaluate(false)
	}

	mod.hook('S_LOGIN', 'raw', {order: 100, filter: {fake: null}}, reset)
	mod.hook('S_RETURN_TO_LOBBY', 'raw', reset)

	// Runs before the core's own S_LOAD_TOPO reset (order -100 < 0) so the core already sees the new state.
	mod.hook('S_LOAD_TOPO', 3, {order: -100, filter: {fake: null}}, event => {
		zone = event.zone
		channel = -1 // only channel zones send S_CURRENT_CHANNEL afterwards; dungeons/battlegrounds stay "unknown"
		evaluate()
	})

	mod.hook('S_CURRENT_CHANNEL', 1, {order: -100, filter: {fake: null}}, event => {
		zone = event.zone
		channel = event.channel
		evaluate()
	})

	Object.defineProperties(this, {
		suspended: { get() { return suspended } },
		reason: { get() { return reason } },
		zone: { get() { return zone } },
		channel: { get() { return channel } }
	})

	// Called by the core; cb(suspended, reason)
	this.onChange = cb => { listeners.push(cb) }

	// Re-evaluate after a settings change (command); announces only if the state flips
	this.refresh = () => { evaluate() }

	this.status = () => {
		const s = settings(), t = text()
		if(s.enabled === false) return t.disabled
		const where = `zone ${zone}, channel ${channel >= 0 ? displayedChannel() : '?'}`
		return `${suspended ? (reason === 'battleground' ? t.battleground : t.channel(displayedChannel())) : t.resumed} (${where})`
	}
}
