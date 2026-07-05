/**
 * Hosts the legacy workspace and the Workspace 2.0 prototype, with a small
 * floating toggle (top right). The legacy workspace stays mounted underneath
 * so switching back never re-initializes its WebGL state.
 * @module
 */

import React, { useState } from 'react'

import Workspace from './workspace'
import Workspace2 from './workspace2'

const KEY = 'LaserWeb.workspace2'

export default function WorkspaceSwitcher() {
    const [v2, setV2] = useState(() =>
        window.localStorage.getItem(KEY) === 'true' || /[?&]ws2=1/.test(window.location.search))

    const toggle = () => {
        window.localStorage.setItem(KEY, String(!v2))
        setV2(!v2)
    }

    return (
        <div style={{ flexGrow: 1, display: 'flex', position: 'relative' }}>
            <Workspace style={{ flexGrow: 1, position: 'relative' }} />
            {v2 && <Workspace2 style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 5 }} />}
            <button onClick={toggle}
                title={v2 ? 'Back to the classic workspace' : 'Try Workspace 2.0 (PixiJS prototype: pan/zoom, view-only)'}
                style={{
                    position: 'absolute', top: 10, right: 10, zIndex: 6,
                    padding: '3px 10px', borderRadius: 12, fontSize: 12,
                    border: '1px solid #4da3ff55', cursor: 'pointer',
                    background: v2 ? '#4da3ff' : 'rgba(20,23,28,.75)',
                    color: v2 ? '#0b1220' : '#4da3ff',
                }}>
                {v2 ? '⬅ classic' : 'canvas 2.0'}
            </button>
        </div>
    )
}
