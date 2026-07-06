/**
 * AppShell 2.0: Claude Design top bar + nav rail. It replaces the visual
 * dock while still driving the same panes reducer underneath.
 * @module
 */

import React, { useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'

import { selectPane } from '../actions/panes'
import { setSettingsAttrs } from '../actions/settings'
import { abortJob, resetMachine, runCommand } from './com'
import CommandHistory from './command-history'
import { t } from '../lib/i18n'

const CONSOLE_KEY = 'LaserWeb.appShell2Console'

const NAV = [
    ['cam', 'th-large', 'Workshop'],
    ['com', 'exchange', 'Comms'],
    ['jog', 'arrows', 'Control'],
    ['settings', 'cog', 'Settings'],
    ['about', 'question', 'Help'],
]

function NavItem({ id, icon, label, active, onClick }) {
    return (
        <button className={'app2-nav-item' + (active ? ' active' : '')}
            title={label} onClick={onClick}>
            <i className={`fa fa-${icon}`} />
            <span>{label}</span>
        </button>
    )
}

export default function AppShell2({ children, onClassic }) {
    const dispatch = useDispatch()
    const panes = useSelector(s => s.panes)
    const settings = useSelector(s => s.settings)
    const com = useSelector(s => s.com)
    const gcode = useSelector(s => s.gcode.content)
    const gcodeDirty = useSelector(s => s.gcode.dirty)
    const [consoleOpen, setConsoleOpen] = useState(() => window.localStorage.getItem(CONSOLE_KEY) === 'true')

    const toggleConsole = () => {
        window.localStorage.setItem(CONSOLE_KEY, String(!consoleOpen))
        setConsoleOpen(!consoleOpen)
    }

    const connected = com.serverConnected && com.machineConnected
    const running = connected && (com.playing || com.machineStatus === 'Run')
    const status = connected ? (com.machineStatus || t('Connected')) : t('Not connected')
    const machineLabel = settings.machineDescription || 'LaserWeb'
    const bed = `${settings.toolGridWidth || 0} x ${settings.toolGridHeight || 0} mm`

    const estop = () => {
        if (running) abortJob()
        else resetMachine()
    }

    return (
        <div className={'app2-shell' + (consoleOpen ? ' app2-has-console' : '')}>
            <header className="app2-topbar">
                <div className="app2-brand">
                    <div className="app2-logo">f</div>
                    <div>
                        <div className="app2-brand-name">frakie</div>
                        <div className="app2-brand-sub">plotter / laser</div>
                    </div>
                </div>

                <div className="app2-sep" />

                <button className="app2-machine" onClick={() => dispatch(selectPane('com'))}>
                    <span className={'app2-dot' + (connected ? ' on' : '')} />
                    <span>
                        <strong>{machineLabel}</strong>
                        <small>{connected ? status : bed}</small>
                    </span>
                </button>

                <div className="app2-spacer" />

                <button className="app2-pill" onClick={() => dispatch(selectPane('cam'))}
                    title={gcode ? (gcodeDirty ? t('G-code is stale — regenerate in Files') : t('G-code generated — click to open Files')) : t('No G-code loaded — generate it in the Files pane')}>
                    <i className={`fa fa-${gcode ? (gcodeDirty ? 'warning' : 'check') : 'file-o'}`} />
                    <span>{gcode ? (gcodeDirty ? t('Stale G-code') : t('G-code ready')) : t('No G-code')}</span>
                </button>

                <button className={'app2-pill' + (consoleOpen ? ' on' : '')} onClick={toggleConsole}
                    title={consoleOpen ? t('Hide the command console') : t('Show the command console')}>
                    <i className="fa fa-terminal" />
                    <span>{t('Console')}</span>
                </button>

                <label className="app2-toggle">
                    <span>{t('Expert mode')}</span>
                    <span className={'d2-toggle' + (settings.useAppShell2Expert ? ' on' : '')}
                        onClick={() => dispatch(setSettingsAttrs({ useAppShell2Expert: !settings.useAppShell2Expert }))}>
                        <span className="d2-knob" />
                    </span>
                </label>

                <button className="app2-pill" onClick={onClassic} title={t('Back to classic UI')}>
                    <i className="fa fa-columns" />
                    <span>{t('Classic')}</span>
                </button>

                <button className="app2-estop" onClick={estop} title={t('Emergency stop')}>
                    <span /> {t('STOP')}
                </button>
            </header>

            <div className="app2-body">
                <nav className="app2-nav">
                    {NAV.slice(0, 4).map(([id, icon, label]) => (
                        <NavItem key={id} id={id} icon={icon} label={t(label)}
                            active={panes.selected === id && panes.visible}
                            onClick={() => dispatch(selectPane(id))} />
                    ))}
                    <div className="app2-nav-fill" />
                    {NAV.slice(4).map(([id, icon, label]) => (
                        <NavItem key={id} id={id} icon={icon} label={t(label)}
                            active={panes.selected === id && panes.visible}
                            onClick={() => dispatch(selectPane(id))} />
                    ))}
                </nav>
                <div className="app2-main">
                    <div className="app2-content">{children}</div>
                    {consoleOpen && (
                        <div className="app2-console">
                            <CommandHistory id="app2-command-history" onCommandExec={runCommand} />
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
