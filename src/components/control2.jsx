/**
 * Control 2.0 — the Claude Design control surface, mounted as a parallel
 * surface next to the legacy Jog pane (same pattern as canvas 2.0).
 *
 * Reads machine state from redux only (com.machineStatus/playing/paused/
 * queued/jobPercent/feedOverride/spindleOverride, workspace.cursorPos) and
 * acts through the same com.jsx functions the legacy pane uses, so both
 * surfaces stay interchangeable at any moment.
 * @module
 */

import React, { useEffect, useRef, useState } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import chunk from 'chunk'

import {
    runCommand, runJob, pauseJob, resumeJob, abortJob, clearAlarm,
    setZero, gotoZero, home, probe, laserTest, jog,
    feedOverride, spindleOverride, feedOverrideTo, spindleOverrideTo,
    resetMachine,
} from './com'
import { setLiveJoggingState } from './jog'
import { selectPane } from '../actions/panes'
import { setSettingsAttrs } from '../actions/settings'
import { parseGcode } from '../lib/tmpParseGcode'
import CommandHistory from './command-history'
import { MacrosBar } from './macros'
import { t } from '../lib/i18n'

const HOLD_MS = 700

/* Hold-to-confirm: fires once when the pointer stays down HOLD_MS. */
function useHold(onFire, enabled) {
    const [pct, setPct] = useState(0)
    const timer = useRef(null)
    const stop = () => { clearInterval(timer.current); timer.current = null; setPct(0) }
    useEffect(() => stop, [])
    const start = () => {
        if (!enabled || timer.current) return
        const t0 = Date.now()
        timer.current = setInterval(() => {
            const p = Math.min(100, ((Date.now() - t0) / HOLD_MS) * 100)
            setPct(p)
            if (p >= 100) { stop(); onFire() }
        }, 40)
    }
    return { pct, start, stop }
}

function HoldButton({ label, holdLabel, onFire, enabled, style, title }) {
    const { pct, start, stop } = useHold(onFire, enabled)
    return (
        <button title={title} disabled={!enabled}
            onMouseDown={start} onMouseUp={stop} onMouseLeave={stop}
            onTouchStart={start} onTouchEnd={stop}
            style={{ position: 'relative', overflow: 'hidden', ...style }}>
            <span style={{ position: 'relative', zIndex: 1 }}>{pct > 0 ? holdLabel : label}</span>
            <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, background: 'oklch(1 0 0 / 0.28)', transition: 'width .04s linear' }} />
        </button>
    )
}

function SectionTitle({ children, sub }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--fp-text-soft)', letterSpacing: '0.04em' }}>{children}</span>
            {sub && <span style={{ fontSize: 10, color: 'var(--fp-text-muted)' }}>{sub}</span>}
        </div>
    )
}

const gcodeBounds = (gcode) => {
    let xMin = Number.MAX_VALUE, xMax = -Number.MAX_VALUE, yMin = Number.MAX_VALUE, yMax = -Number.MAX_VALUE
    let found = false
    chunk(parseGcode(gcode), 9).forEach(([g, x, y]) => {
        if (g && (x || y)) {
            found = true
            if (x < xMin) xMin = x; if (x > xMax) xMax = x
            if (y < yMin) yMin = y; if (y > yMax) yMax = y
        }
    })
    return found ? { xMin, xMax, yMin, yMax } : null
}

/* ---- DRO --------------------------------------------------------------- */

function DroAxis({ axis, value, dimmed, onMenu, menuOpen }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--fp-surface)', border: '1px solid var(--fp-border-input)', borderRadius: 10, padding: '8px 10px 8px 12px', opacity: dimmed ? 0.55 : 1 }}>
            <span style={{ width: 16, fontFamily: 'var(--fp-mono)', fontWeight: 700, color: 'var(--fp-text-soft)', fontSize: 13 }}>{axis}</span>
            <span style={{ flex: 1, fontFamily: 'var(--fp-mono)', fontWeight: 700, fontSize: 22, letterSpacing: '-0.01em', color: dimmed ? 'var(--fp-text-muted)' : 'var(--fp-text)' }}>{value}</span>
            <span style={{ fontSize: 10, color: 'var(--fp-text-muted)' }}>mm</span>
            <button title={t('Axis actions')} onClick={onMenu}
                style={{ width: 28, height: 28, border: '1px solid var(--fp-border-input)', borderRadius: 7, background: menuOpen ? 'var(--fp-panel2)' : 'var(--fp-surface)', color: 'var(--fp-text-muted)', cursor: 'pointer', fontSize: 14 }}>⋯</button>
        </div>
    )
}

function AxisMenu({ axis, enabled, probeOffset, onDone }) {
    const lower = axis.toLowerCase()
    const item = (icon, label, fn) => (
        <button disabled={!enabled} onClick={() => { fn(); onDone() }}
            style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left', padding: '7px 8px', border: 'none', borderRadius: 7, background: 'none', color: enabled ? 'var(--fp-text)' : 'var(--fp-text-muted)', fontSize: 12, cursor: enabled ? 'pointer' : 'not-allowed' }}>
            <span>{icon}</span> {label}
        </button>
    )
    return (
        <div style={{ marginTop: 6, background: 'var(--fp-surface)', border: '1px solid var(--fp-border-input)', borderRadius: 10, padding: 5, boxShadow: '0 6px 18px oklch(0 0 0 / 0.1)' }}>
            <div style={{ fontSize: 10, color: 'var(--fp-text-muted)', fontWeight: 600, padding: '4px 8px 6px' }}>{t('Axis')} {axis}</div>
            {item('⌂', `${t('Home axis')} ${axis}`, () => home(lower))}
            {item('⊹', t('Set zero here'), () => setZero(lower))}
            {item('→', t('G0 to zero'), () => gotoZero(lower))}
            <div style={{ height: 1, background: 'var(--fp-border)', margin: '4px 6px' }} />
            {item('▽', `Probe ${axis} Min`, () => probe(`${lower}-`, probeOffset))}
            {item('△', `Probe ${axis} Max`, () => probe(lower, probeOffset))}
        </div>
    )
}

/* ---- main -------------------------------------------------------------- */

export default function Control2() {
    const dispatch = useDispatch()
    const com = useSelector(s => s.com)
    const gcode = useSelector(s => s.gcode.content)
    const gcodeDirty = useSelector(s => s.gcode.dirty)
    const settings = useSelector(s => s.settings)
    const cursorPos = useSelector(s => s.workspace.cursorPos)

    // view state (mockup: disconnected > alarm > running > idle)
    const connected = com.serverConnected && com.machineConnected
    const alarm = connected && com.machineStatus === 'Alarm'
    const running = connected && !alarm && (com.playing || com.machineStatus === 'Run')
    const idle = connected && !alarm && !running

    const [homed, setHomed] = useState(false)
    const [live, setLive] = useState(false)
    const [armed, setArmed] = useState(false)
    const [advanced, setAdvanced] = useState(false)
    const [axisMenu, setAxisMenu] = useState(null)
    const [dragF, setDragF] = useState(null)
    const [dragS, setDragS] = useState(null)

    const markHomed = () => {
        setHomed(true)
        setLiveJoggingState({ hasHomed: true, disabled: false })
    }

    // jog
    const jogEnabled = idle
    const step = settings.jogStepsize
    const feedMult = settings.toolFeedUnits === 'mm/s' ? 60 : 1
    const doJog = (axis, dir) => {
        if (!jogEnabled) return
        const feed = (axis === 'Z' ? settings.jogFeedZ : settings.jogFeedXY) * feedMult
        CommandHistory.log(`jog(${axis},${dir}${step},${feed})`)
        jog(axis, (dir === '+' ? '' : '-') + step, feed)
    }

    // overrides: show the dragged value while dragging, the reported one after
    const fShown = dragF !== null ? dragF : (com.feedOverride || 100)
    const sShown = dragS !== null ? dragS : (com.spindleOverride || 100)

    // laser test (settings-driven, arm + hold like the mockup)
    const testPower = settings.gcodeToolTestPower
    const testDuration = settings.gcodeToolTestDuration
    const fireEnabled = armed && connected && !running && testPower > 0
    const fire = () => {
        laserTest(testPower, testDuration, settings.gcodeSMaxValue)
        setArmed(false)
    }

    const doCheckSize = () => {
        const bounds = gcodeBounds(gcode)
        if (!bounds) {
            CommandHistory.warn(t('Check size: no G-code with movements loaded — generate a job in the Files pane first.'))
            return
        }
        const feed = settings.jogFeedXY * feedMult
        const power = settings.gcodeCheckSizePower / 100 * settings.gcodeSMaxValue
        runCommand(`G90\nG0 X${bounds.xMin} Y${bounds.yMin} F${feed}\nG1 F${feed} S${power}\nG1 X${bounds.xMax} Y${bounds.yMin}\nG1 X${bounds.xMax} Y${bounds.yMax}\nG1 X${bounds.xMin} Y${bounds.yMax}\nG1 X${bounds.xMin} Y${bounds.yMin}\nG90\n`)
    }

    // state header theming
    let stateLabel, badgeColors, headBg = 'transparent', dot
    if (!connected) { stateLabel = t('Not connected'); badgeColors = ['var(--fp-panel2)', 'var(--fp-text-soft)', 'var(--fp-border-input)']; dot = 'oklch(0.7 0.01 60)' }
    else if (alarm) { stateLabel = t('ALARM'); badgeColors = ['var(--fp-danger-soft)', 'var(--fp-danger)', 'var(--fp-danger-line)']; dot = 'var(--fp-danger)'; headBg = 'var(--fp-danger-soft)' }
    else if (running) { stateLabel = com.paused ? t('Paused') : t('Running'); badgeColors = ['var(--fp-amber-soft)', 'var(--fp-amber-deep)', 'var(--fp-amber-line)']; dot = 'var(--fp-amber)'; headBg = 'var(--fp-amber-soft)' }
    else { stateLabel = com.machineStatus || 'Idle'; badgeColors = ['var(--fp-go-soft)', 'var(--fp-go-deep)', 'var(--fp-go-line)']; dot = 'var(--fp-go)' }

    const gcodeLines = gcode ? gcode.split(/\r\n|\r|\n/).length : 0
    const gcodeStatus = gcode
        ? `${gcodeLines} ${t('lines')}${gcodeDirty ? t(' (stale)') : ''}`
        : t('no G-code')

    const [px, py, pz] = (cursorPos || []).map(v => Number(v))
    const droVal = v => (connected && isFinite(v)) ? v.toFixed(2) : '—'

    // shared button styles
    const btn = (extra) => ({ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, border: '1px solid var(--fp-border-input)', borderRadius: 10, background: 'var(--fp-surface)', color: 'var(--fp-text)', fontWeight: 600, fontSize: 12.5, cursor: 'pointer', ...extra })
    const btnDisabled = (extra) => ({ ...btn(extra), background: 'var(--fp-panel2)', color: 'var(--fp-text-muted)', cursor: 'not-allowed' })
    const jogBtn = (enabled) => ({ border: '1px solid var(--fp-border-input)', borderRadius: 9, background: enabled ? 'var(--fp-surface)' : 'var(--fp-panel2)', color: enabled ? 'var(--fp-text)' : 'var(--fp-text-muted)', cursor: enabled ? 'pointer' : 'not-allowed', fontFamily: 'var(--fp-mono)', fontWeight: 700, fontSize: 12, width: 42, height: 42 })
    const stepBtn = (v) => ({ flex: 1, fontSize: 10.5, padding: '6px 0', border: `1px solid ${step === v ? 'var(--fp-go)' : 'var(--fp-border-input)'}`, borderRadius: 7, background: step === v ? 'var(--fp-go-soft)' : 'var(--fp-surface)', color: step === v ? 'var(--fp-go-deep)' : 'var(--fp-text-muted)', fontWeight: step === v ? 700 : 500, cursor: 'pointer', fontFamily: 'var(--fp-mono)' })
    const kbd = { fontFamily: 'var(--fp-mono)', fontSize: 9.5, background: 'var(--fp-panel2)', border: '1px solid var(--fp-border-input)', borderRadius: 5, padding: '2px 6px', color: 'var(--fp-text-muted)' }

    const feedInput = (label, field) => (
        <label style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: 'var(--fp-text-muted)', fontWeight: 600, marginBottom: 4 }}>{label}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'var(--fp-surface)', border: '1px solid var(--fp-border-input)', borderRadius: 8, padding: '6px 8px' }}>
                <input value={settings[field]} onChange={e => { const v = +e.target.value; if (isFinite(v)) dispatch(setSettingsAttrs({ [field]: v })) }}
                    style={{ width: '100%', minWidth: 0, border: 'none', background: 'none', outline: 'none', fontFamily: 'var(--fp-mono)', fontSize: 12, color: 'var(--fp-text)' }} />
                <span style={{ fontSize: 9, color: 'var(--fp-text-muted)', whiteSpace: 'nowrap' }}>{settings.toolFeedUnits}</span>
            </div>
        </label>
    )

    const override = (label, letter, shown, setDrag, commitTo, reset, accent, warn) => (
        <div style={{ background: 'var(--fp-surface)', border: '1px solid var(--fp-border-input)', borderRadius: 11, padding: '11px 12px', opacity: connected ? 1 : 0.5, pointerEvents: connected ? 'auto' : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 7 }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{label} <span style={{ fontFamily: 'var(--fp-mono)', color: 'var(--fp-text-muted)', fontWeight: 500 }}>{letter}</span></span>
                <span style={{ flex: 1 }} />
                <span style={{ fontFamily: 'var(--fp-mono)', fontWeight: 700, fontSize: 16 }}>{shown}<span style={{ fontSize: 11, color: 'var(--fp-text-muted)' }}>%</span></span>
                <button title={t('Reset to 100%')} onClick={reset}
                    style={{ fontSize: 10, color: 'var(--fp-text-muted)', background: 'var(--fp-surface)', border: '1px solid var(--fp-border-input)', borderRadius: 6, padding: '3px 6px', cursor: 'pointer' }}>↺</button>
            </div>
            <input type="range" min={10} max={200} value={shown}
                onChange={e => setDrag(+e.target.value)}
                onMouseUp={e => { commitTo(+e.target.value); setDrag(null) }}
                onTouchEnd={e => { commitTo(+e.target.value); setDrag(null) }}
                style={{ width: '100%', accentColor: accent, height: 4, margin: 0 }} />
            {warn && <div style={{ fontSize: 10, color: 'var(--fp-amber-deep)', marginTop: 5 }}>{warn}</div>}
        </div>
    )

    return (
        // cancel the pane's 10px padding (top/left/bottom) so the surface
        // runs edge to edge with its own fixed header and action bar
        <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100% + 20px)', margin: '-10px 0 -10px -10px', background: 'var(--fp-panel)', fontSize: 13 }}>

            {/* MachineStateHeader */}
            <div style={{ flex: '0 0 auto', padding: '12px 14px', borderBottom: '1px solid var(--fp-border-input)', background: headBg }}>
                {/* right padding leaves room for the floating surface toggle */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingRight: 72 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, padding: '5px 11px', borderRadius: 9, background: badgeColors[0], color: badgeColors[1], border: `1px solid ${badgeColors[2]}` }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot }} />{stateLabel}
                    </span>
                    <div style={{ flex: 1 }} />
                    <span title={t('G-code loaded for Run')} style={{ fontSize: 11, fontFamily: 'var(--fp-mono)', color: gcodeDirty ? 'var(--fp-amber-deep)' : 'var(--fp-text-muted)' }}>{gcodeStatus}</span>
                </div>
                {running && com.queued > 0 && (
                    <div style={{ marginTop: 11 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 5 }}>
                            <span style={{ fontWeight: 600, color: 'var(--fp-amber-deep)' }}>
                                {com.jobPercent !== null && com.jobPercent !== undefined ? `${com.jobPercent}% ${t('sent')} · ` : ''}{com.queued} {t('queued')}
                            </span>
                        </div>
                        <div style={{ height: 7, background: 'var(--fp-surface)', border: '1px solid var(--fp-amber-line)', borderRadius: 5, overflow: 'hidden' }}>
                            <div style={{ width: `${com.jobPercent || 0}%`, height: '100%', background: 'var(--fp-amber)' }} />
                        </div>
                    </div>
                )}
                {alarm && (
                    <div style={{ marginTop: 9, fontSize: 11.5, color: 'var(--fp-danger-deep)', lineHeight: 1.4 }}>
                        <strong>{t('Motion locked.')}</strong> {t('The machine hit a limit or was stopped. Home or Unlock to continue.')}
                    </div>
                )}
            </div>

            {/* scroll body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>

                {/* DRO */}
                <div style={{ marginBottom: 14 }}>
                    <SectionTitle sub={`· ${t('work coordinates (mm)')}`}>{t('POSITION')}</SectionTitle>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <DroAxis axis="X" value={droVal(px)} dimmed={!connected} menuOpen={axisMenu === 'X'} onMenu={() => setAxisMenu(m => m === 'X' ? null : 'X')} />
                        <DroAxis axis="Y" value={droVal(py)} dimmed={!connected} menuOpen={axisMenu === 'Y'} onMenu={() => setAxisMenu(m => m === 'Y' ? null : 'Y')} />
                        {settings.machineZEnabled &&
                            <DroAxis axis="Z" value={droVal(pz)} dimmed={!connected} menuOpen={axisMenu === 'Z'} onMenu={() => setAxisMenu(m => m === 'Z' ? null : 'Z')} />}
                    </div>
                    {axisMenu &&
                        <AxisMenu axis={axisMenu} enabled={idle} onDone={() => setAxisMenu(null)}
                            probeOffset={axisMenu === 'Z' ? settings.machineZProbeOffset : settings.machineXYProbeOffset} />}
                    {!settings.machineZEnabled &&
                        <div style={{ marginTop: 8, fontSize: 10.5, color: 'var(--fp-text-muted)' }}>
                            {t('Z · A not enabled on this machine')} · <span style={{ color: 'var(--fp-accent)', cursor: 'pointer' }} onClick={() => dispatch(selectPane('settings'))}>{t('configure axes')}</span>
                        </div>}
                </div>

                {/* JOG */}
                <div style={{ marginBottom: 14, opacity: (running || alarm) ? 0.5 : 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--fp-text-soft)', letterSpacing: '0.04em' }}>JOG</span>
                        <span style={{ fontSize: 10, color: 'var(--fp-text-muted)' }}>{t('move the head by hand')}</span>
                        <div style={{ flex: 1 }} />
                        {(running || alarm) &&
                            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--fp-danger)', background: 'var(--fp-danger-soft)', border: '1px solid var(--fp-danger-line)', borderRadius: 6, padding: '2px 7px' }}>🔒 {t('locked')}</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${settings.machineZEnabled ? 4 : 3}, 42px)`, gridTemplateRows: 'repeat(3, 42px)', gap: 5, flex: '0 0 auto' }}>
                            <span />
                            <button style={jogBtn(jogEnabled)} onClick={() => doJog('Y', '+')}>Y+</button>
                            <span />
                            {settings.machineZEnabled && <button style={jogBtn(jogEnabled)} onClick={() => doJog('Z', '+')}>Z+</button>}
                            <button style={jogBtn(jogEnabled)} onClick={() => doJog('X', '-')}>X−</button>
                            <button title={t('Go to zero')} style={{ ...jogBtn(jogEnabled), background: jogEnabled ? 'var(--fp-go-soft)' : 'var(--fp-panel2)', color: jogEnabled ? 'var(--fp-go-deep)' : 'var(--fp-text-muted)', fontSize: 14 }} onClick={() => jogEnabled && gotoZero('all')}>⊹</button>
                            <button style={jogBtn(jogEnabled)} onClick={() => doJog('X', '+')}>X+</button>
                            {settings.machineZEnabled && <span />}
                            <span />
                            <button style={jogBtn(jogEnabled)} onClick={() => doJog('Y', '-')}>Y−</button>
                            <span />
                            {settings.machineZEnabled && <button style={jogBtn(jogEnabled)} onClick={() => doJog('Z', '-')}>Z−</button>}
                        </div>
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
                            <div>
                                <div style={{ fontSize: 10, color: 'var(--fp-text-muted)', fontWeight: 600, marginBottom: 4 }}>{t('STEP (mm)')}</div>
                                <div style={{ display: 'flex', gap: 3 }}>
                                    {[0.1, 1, 10, 100].map(v =>
                                        <button key={v} style={stepBtn(v)} onClick={() => dispatch(setSettingsAttrs({ jogStepsize: v }))}>{v}</button>)}
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                                {feedInput(t('SPEED XY'), 'jogFeedXY')}
                                {settings.machineZEnabled ? feedInput('FEED Z', 'jogFeedZ') : null}
                            </div>
                        </div>
                    </div>
                    <div style={{ marginTop: 11, display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', background: 'var(--fp-surface)', border: '1px solid var(--fp-border-input)', borderRadius: 10 }}>
                        <span className={'d2-toggle' + (live && homed ? ' on' : '')} style={{ opacity: homed ? 1 : 0.5 }}
                            onClick={() => { if (homed) { setLive(l => { setLiveJoggingState({ active: !l }); return !l }) } }}>
                            <span className="d2-knob" />
                        </span>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 12, fontWeight: 600 }}>Live jogging</div>
                            <div style={{ fontSize: 10.5, color: 'var(--fp-text-muted)', marginTop: 1 }}>
                                {homed ? t('Alt+click on the canvas travels to that point.') : t('Requires homing first — Home to enable.')}
                            </div>
                        </div>
                    </div>
                    <div style={{ marginTop: 8, fontSize: 10, color: 'var(--fp-text-muted)', display: 'flex', gap: 12 }}>
                        <span>⌨ {t('Alt+arrows / numpad')}</span>
                    </div>
                </div>

                {/* OVERRIDES */}
                <div style={{ margin: '14px 0' }}>
                    <SectionTitle sub={<span style={{ color: 'var(--fp-go)', fontWeight: 600 }}>· {t('adjustable while running')}</span>}>OVERRIDES</SectionTitle>
                    {override(t('Speed'), 'F', fShown, setDragF, feedOverrideTo, () => feedOverride(0), 'var(--fp-go)', null)}
                    <div style={{ height: 9 }} />
                    {override(t('Power'), 'S', sShown, setDragS, spindleOverrideTo, () => spindleOverride(0), 'var(--fp-amber)', `⚠ ${t('S is laser power, not speed.')}`)}
                </div>

                {/* Prep actions */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                    <button style={idle ? btn({ flex: 1, padding: 11 }) : btnDisabled({ flex: 1, padding: 11 })} disabled={!idle}
                        onClick={() => { setZero('all'); markHomed() }}><span style={{ fontSize: 14 }}>⊹</span> {t('Set zero')}</button>
                    <button style={idle ? btn({ flex: 1, padding: 11 }) : btnDisabled({ flex: 1, padding: 11 })} disabled={!idle}
                        onClick={doCheckSize}><span style={{ fontSize: 14 }}>⊡</span> Check size</button>
                </div>

                {/* LASER TEST */}
                <div style={{ border: '1px solid var(--fp-amber-line)', borderRadius: 11, background: 'var(--fp-amber-soft)', padding: 11, marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--fp-amber-deep)', letterSpacing: '0.03em' }}>⚡ LASER TEST</span>
                        <div style={{ flex: 1 }} />
                        <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
                            <span style={{ fontSize: 10.5, color: 'var(--fp-text-soft)', fontWeight: 600 }}>{t('Arm')}</span>
                            <span className={'d2-toggle' + (armed ? ' on' : '')} style={armed ? { background: 'var(--fp-danger)' } : {}} onClick={() => setArmed(a => !a)}>
                                <span className="d2-knob" />
                            </span>
                        </label>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 9 }}>
                        <div style={{ flex: 1, background: 'var(--fp-surface)', border: '1px solid var(--fp-border-input)', borderRadius: 8, padding: '5px 8px' }}>
                            <div style={{ fontSize: 9, color: 'var(--fp-text-muted)', fontWeight: 600 }}>{t('POWER')}</div>
                            <div style={{ fontFamily: 'var(--fp-mono)', fontWeight: 700, fontSize: 13 }}>{testPower}%</div>
                        </div>
                        <div style={{ flex: 1, background: 'var(--fp-surface)', border: '1px solid var(--fp-border-input)', borderRadius: 8, padding: '5px 8px' }}>
                            <div style={{ fontSize: 9, color: 'var(--fp-text-muted)', fontWeight: 600 }}>{t('DURATION')}</div>
                            <div style={{ fontFamily: 'var(--fp-mono)', fontWeight: 700, fontSize: 13 }}>{testDuration} ms</div>
                        </div>
                        <HoldButton enabled={fireEnabled} onFire={fire}
                            label={!armed ? t('Arm first') : (testPower > 0 ? t('Hold to fire') : t('Power is 0'))}
                            holdLabel={t('Firing…')}
                            style={{ flex: '0 0 auto', width: 118, padding: '5px 10px', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 11.5, cursor: fireEnabled ? 'pointer' : 'not-allowed', background: fireEnabled ? 'var(--fp-danger)' : 'var(--fp-panel2)', color: fireEnabled ? '#fff' : 'var(--fp-text-muted)' }} />
                    </div>
                    {testPower <= 0 &&
                        <div style={{ fontSize: 10, color: 'var(--fp-amber-deep)', marginTop: 6 }}>{t('Test power is 0 — set it in Settings → Gcode.')}</div>}
                </div>

                {/* ADVANCED */}
                <div style={{ border: '1px solid var(--fp-border)', borderRadius: 11, background: 'var(--fp-surface)', overflow: 'hidden' }}>
                    <div onClick={() => setAdvanced(a => !a)} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '11px 13px', cursor: 'pointer' }}>
                        <span style={{ display: 'inline-block', transition: 'transform .15s', transform: `rotate(${advanced ? 90 : 0}deg)`, color: 'var(--fp-text-muted)', fontSize: 11 }}>▸</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--fp-text-soft)', letterSpacing: '0.03em' }}>{t('ADVANCED')}</span>
                        <span style={{ flex: 1 }} />
                        <span style={{ fontSize: 10, color: 'var(--fp-text-muted)' }}>{t('reset, probe, macros')}</span>
                    </div>
                    {advanced && (
                        <div style={{ padding: '0 13px 13px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                                <button style={btn({ padding: 9, fontSize: 11.5, background: 'var(--fp-panel2)', color: 'var(--fp-text-soft)' })}
                                    title={t('Soft-reset the firmware (ctrl-x). Clears the queue; position survives.')}
                                    onClick={() => resetMachine()}>⟲ Reset (^X)</button>
                                <button style={btn({ padding: 9, fontSize: 11.5, background: 'var(--fp-panel2)', color: 'var(--fp-text-soft)' })}
                                    title={t('Probe Z down to the stock surface')}
                                    onClick={() => probe('z-', settings.machineZProbeOffset)}>⤢ Probe Z</button>
                            </div>
                            <MacrosBar />
                        </div>
                    )}
                </div>

                {/* Shortcuts */}
                <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--fp-text-muted)', letterSpacing: '0.04em', marginBottom: 7 }}>{t('SHORTCUTS')}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11, color: 'var(--fp-text-soft)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Jog</span><kbd style={kbd}>alt ←↑↓→</kbd></div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{t('Step size')}</span><kbd style={kbd}>ctrl alt 1–4</kbd></div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Home all</span><kbd style={kbd}>ctrl alt H</kbd></div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Check size</span><kbd style={kbd}>ctrl alt C</kbd></div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{t('Set zero (axis)')}</span><kbd style={kbd}>ctrl alt ⇧ X/Y/Z</kbd></div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Run job</span><kbd style={kbd}>ctrl alt ⇧ R</kbd></div>
                    </div>
                </div>
            </div>

            {/* PrimaryActionBar */}
            <div style={{ flex: '0 0 auto', borderTop: '1px solid var(--fp-border-input)', background: 'var(--fp-surface)', padding: '12px 14px' }}>
                {!connected && (
                    <>
                        <button onClick={() => dispatch(selectPane('com'))}
                            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, padding: 14, border: 'none', borderRadius: 12, background: 'var(--fp-go)', color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer', boxShadow: '0 2px 10px oklch(0.56 0.13 152 / 0.35)' }}>
                            ↔ {t('Connect machine')}</button>
                        <div style={{ fontSize: 10.5, color: 'var(--fp-text-muted)', textAlign: 'center', marginTop: 7 }}>{t('Connect to enable jog, homing and runs.')}</div>
                    </>
                )}
                {idle && (
                    <div style={{ display: 'flex', gap: 9 }}>
                        <HoldButton enabled={true} onFire={() => { runCommand(settings.gcodeHoming); markHomed() }}
                            label={`⌂ ${t('Hold to Home')}`} holdLabel={`⌂ ${t('Homing…')}`}
                            title={t('Hold the button to home all axes')}
                            style={btn({ flex: '0 0 auto', width: 118, padding: '14px 8px', borderRadius: 12, fontWeight: 700, fontSize: 12.5 })} />
                        <button onClick={() => runJob(gcode)} disabled={!gcode}
                            title={gcode ? (gcodeDirty ? t('G-code is stale — regenerate in Files to pick up changes') : t('Send the loaded G-code to the machine')) : t('No G-code loaded — generate it in the Files pane')}
                            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 14, border: 'none', borderRadius: 12, background: gcode ? 'var(--fp-go)' : 'var(--fp-panel2)', color: gcode ? '#fff' : 'var(--fp-text-muted)', fontWeight: 700, fontSize: 15, cursor: gcode ? 'pointer' : 'not-allowed', boxShadow: gcode ? '0 2px 10px oklch(0.56 0.13 152 / 0.35)' : 'none' }}>
                            <span style={{ fontSize: 15 }}>▶</span> Run</button>
                        <button title={t('Emergency stop')} onClick={() => abortJob()}
                            style={{ flex: '0 0 auto', width: 58, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '14px 0', border: '1.5px solid var(--fp-danger-line)', borderRadius: 12, background: 'var(--fp-danger-soft)', color: 'var(--fp-danger)', cursor: 'pointer' }}>
                            <span style={{ width: 15, height: 15, background: 'var(--fp-danger)', borderRadius: 3 }} /></button>
                    </div>
                )}
                {running && (
                    <div style={{ display: 'flex', gap: 9, alignItems: 'stretch' }}>
                        <button onClick={() => com.paused ? resumeJob() : pauseJob()}
                            style={{ flex: '0 0 auto', width: 96, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, padding: 12, border: '1.5px solid var(--fp-border-input)', borderRadius: 12, background: 'var(--fp-surface)', color: 'var(--fp-text)', cursor: 'pointer' }}>
                            <span style={{ fontSize: 17 }}>{com.paused ? '▶' : '⏸'}</span>
                            <span style={{ fontSize: 11.5, fontWeight: 600 }}>{com.paused ? t('Resume') : t('Pause')}</span></button>
                        <button onClick={() => abortJob()}
                            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 12, border: 'none', borderRadius: 12, background: 'var(--fp-danger)', color: '#fff', fontWeight: 800, fontSize: 17, letterSpacing: '0.02em', cursor: 'pointer' }}>
                            <span style={{ width: 17, height: 17, background: '#fff', borderRadius: 3 }} /> ABORT</button>
                    </div>
                )}
                {alarm && (
                    <div style={{ display: 'flex', gap: 9 }}>
                        <HoldButton enabled={true} onFire={() => { runCommand(settings.gcodeHoming); markHomed() }}
                            label={`⌂ ${t('Hold to Home')}`} holdLabel={`⌂ ${t('Homing…')}`}
                            style={btn({ flex: '0 0 auto', width: 118, padding: '14px 8px', borderRadius: 12, fontWeight: 700, fontSize: 12.5 })} />
                        <button onClick={() => clearAlarm(2)}
                            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, padding: 14, border: 'none', borderRadius: 12, background: 'var(--fp-danger)', color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer', boxShadow: '0 2px 10px oklch(0.55 0.19 27 / 0.4)' }}>
                            🔓 {t('Unlock (clear alarm)')}</button>
                    </div>
                )}
            </div>
        </div>
    )
}
