/**
 * Hosts the classic Files/CAM pane and Workshop 2.0 in parallel.
 * @module
 */

import React, { useState } from 'react'

import Cam from './cam'
import Workshop2 from './workshop2'
import { t } from '../lib/i18n'

const KEY = 'LaserWeb.workshop2'

export default function WorkshopSwitcher() {
    const [v2, setV2] = useState(() =>
        window.localStorage.getItem(KEY) === 'true' || /[?&]wk2=1/.test(window.location.search))

    const toggle = () => {
        window.localStorage.setItem(KEY, String(!v2))
        setV2(!v2)
    }

    return (
        <div style={{ position: 'relative', height: '100%' }}>
            {v2 ? <Workshop2 /> : <div style={{ height: '100%', overflowY: 'auto' }}><Cam /></div>}
            <button onClick={toggle}
                title={v2 ? t('Back to the classic Files pane') : t('Try Workshop 2.0')}
                style={{
                    position: 'absolute', top: v2 ? 13 : 0, right: 8, zIndex: 7,
                    padding: '2px 9px', borderRadius: 12, fontSize: 11,
                    border: '1px solid #4da3ff55', cursor: 'pointer',
                    background: v2 ? '#4da3ff' : 'rgba(20,23,28,.75)',
                    color: v2 ? '#0b1220' : '#4da3ff',
                }}>
                {v2 ? t('< classic') : t('workshop 2.0')}
            </button>
        </div>
    )
}
