/**
 * Hosts the legacy Jog pane and the Control 2.0 surface, with a small toggle
 * (same pattern as workspace-switcher). The legacy pane stays mounted but
 * hidden so its keyboard bindings (alt+arrows, ctrl+alt+…) keep working
 * whichever surface is visible.
 * @module
 */

import React, { useState } from 'react'

import Jog from './jog'
import Control2 from './control2'
import { t } from '../lib/i18n'

const KEY = 'LaserWeb.control2'

export default function ControlSwitcher() {
    const [v2, setV2] = useState(() =>
        window.localStorage.getItem(KEY) === 'true' || /[?&]ctl2=1/.test(window.location.search))

    const toggle = () => {
        window.localStorage.setItem(KEY, String(!v2))
        setV2(!v2)
    }

    return (
        <div style={{ position: 'relative', height: '100%' }}>
            <div style={{ height: '100%', display: v2 ? 'none' : 'block', overflowY: 'auto' }}><Jog /></div>
            {v2 && <Control2 />}
            <button onClick={toggle}
                title={v2 ? t('Back to the classic control pane') : t('Try Control 2.0')}
                style={{
                    position: 'absolute', top: v2 ? 13 : 0, right: 8, zIndex: 7,
                    padding: '2px 9px', borderRadius: 12, fontSize: 11,
                    border: '1px solid #4da3ff55', cursor: 'pointer',
                    background: v2 ? '#4da3ff' : 'rgba(20,23,28,.75)',
                    color: v2 ? '#0b1220' : '#4da3ff',
                }}>
                {v2 ? t('⬅ classic') : t('control 2.0')}
            </button>
        </div>
    )
}
