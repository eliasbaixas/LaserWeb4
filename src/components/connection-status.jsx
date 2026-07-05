/**
 * Floating (fixed) connection status pill, visible from every pane.
 * Green: machine connected. Amber: server up, machine down — click to
 * reconnect with the last known-good settings (they persist in
 * localStorage). Red: comm server down — click to retry the websocket.
 * @module
 */

import React from 'react'
import { useSelector, useDispatch } from 'react-redux'

import Icon from './font-awesome'
import { reconnectServer, reconnectMachine } from './com'
import { selectPane } from '../actions/panes'

const STATES = {
    machine: { color: '#3c763d', bg: '#dff0d8', border: '#d6e9c6', icon: 'plug' },
    server: { color: '#8a6d3b', bg: '#fcf8e3', border: '#faebcc', icon: 'refresh' },
    none: { color: '#a94442', bg: '#f2dede', border: '#ebccd1', icon: 'refresh' },
}

export function ConnectionStatus() {
    const dispatch = useDispatch()
    const selectedPane = useSelector(s => s.panes.selected)
    const serverConnected = useSelector(s => s.com.serverConnected)
    const machineConnected = useSelector(s => s.com.machineConnected)
    const settings = useSelector(s => s.settings)

    const state = machineConnected ? 'machine' : serverConnected ? 'server' : 'none'
    const s = STATES[state]

    const target = settings.connectVia === 'USB'
        ? `${settings.connectPort || '?'} @ ${settings.connectBaud || '?'}`
        : `${settings.connectVia || '?'} ${settings.connectIP || ''}`

    const label = {
        machine: `${settings.connectVia || ''} ${settings.connectVia === 'USB' ? (settings.connectPort || '') : (settings.connectIP || '')}`.trim() || 'connected',
        server: 'machine disconnected',
        none: 'server disconnected',
    }[state]

    const title = {
        machine: `Machine connected (${target})`,
        server: `Click to reconnect the machine: ${target}`,
        none: 'Comm server unreachable — click to retry',
    }[state]

    const clickable = state !== 'machine'
    const onClick = () => {
        if (state === 'server') {
            reconnectMachine(settings)
        } else if (state === 'none' && !reconnectServer()) {
            // The websocket only gets created by the Comms pane; panes mount
            // lazily, so jump there — it connects to the server on mount.
            if (selectedPane !== 'com') dispatch(selectPane('com'))
        }
    }

    return (
        <div onClick={clickable ? onClick : undefined} title={title}
            style={{
                position: 'fixed', right: 14, bottom: 14, zIndex: 2000,
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 12px', borderRadius: 16, fontSize: 12,
                color: s.color, background: s.bg, border: `1px solid ${s.border}`,
                boxShadow: '0 1px 4px rgba(0,0,0,.25)',
                cursor: clickable ? 'pointer' : 'default', userSelect: 'none',
            }}>
            <Icon name={s.icon} />
            <span>{label}</span>
        </div>
    )
}

export default ConnectionStatus
