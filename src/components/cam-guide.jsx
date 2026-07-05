/**
 * Onboarding cards for the Files pane, shown while the workspace is empty
 * (no documents, no operations). One card with the shared concepts and one
 * with the workflow as explicit phases: a branch on the source type
 * (vector vs raster) that converges into Generate -> Run. Each card
 * collapses independently and remembers its state in localStorage.
 * @module
 */

import React, { useState } from 'react'
import { useSelector } from 'react-redux'

import Icon from './font-awesome'
import { t } from '../lib/i18n'

function GuideCard({ storageKey, bsStyle, icon, title, children }) {
    const key = `LaserWeb.camGuide.${storageKey}`
    const [collapsed, setCollapsed] = useState(
        () => window.localStorage.getItem(key) === 'true')

    const toggle = () => {
        window.localStorage.setItem(key, String(!collapsed))
        setCollapsed(!collapsed)
    }

    return (
        <div className={`panel panel-${bsStyle}`} style={{ marginBottom: 3, flexShrink: 0 }}>
            <div className="panel-heading" style={{ padding: '3px 8px', cursor: 'pointer' }} onClick={toggle}
                title={collapsed ? 'Expand' : 'Collapse'}>
                <label style={{ cursor: 'pointer', marginBottom: 0 }}>
                    <Icon name={icon} /> {title}
                </label>
                <span style={{ float: 'right' }}><Icon name={collapsed ? 'chevron-down' : 'chevron-up'} /></span>
            </div>
            {!collapsed &&
                <div className="panel-body" style={{ padding: 8, fontSize: 12, overflowY: 'auto', maxHeight: '50vh' }}>
                    {children}
                </div>}
        </div>
    )
}

function Term({ icon, name, children }) {
    return (
        <p style={{ marginBottom: 6 }}>
            <strong><Icon name={icon} fw /> {name}</strong> — {children}
        </p>
    )
}

function Phase({ n, title, children }) {
    return (
        <div style={{ marginBottom: 8 }}>
            <div style={{ marginBottom: 4 }}>
                <span className="badge" style={{ marginRight: 6 }}>{n}</span>
                <strong>{title}</strong>
            </div>
            {children}
        </div>
    )
}

const BRANCH_COLORS = { info: '#31708f', warning: '#8a6d3b' }

function Branch({ letter, bsStyle, icon, title, children }) {
    return (
        <div style={{
            margin: '4px 0 8px 10px', padding: '4px 8px',
            borderLeft: `3px solid ${BRANCH_COLORS[bsStyle]}`
        }}>
            <div style={{ marginBottom: 4, color: BRANCH_COLORS[bsStyle] }}>
                <span className="badge" style={{ marginRight: 6 }}>{letter}</span>
                <strong><Icon name={icon} /> {title}</strong>
            </div>
            {children}
        </div>
    )
}

export function CamGuide() {
    const empty = useSelector(s => s.documents.length === 0 && s.operations.length === 0)
    if (!empty) return null

    return (
        <div>
            <GuideCard storageKey="concepts" bsStyle="primary" icon="graduation-cap" title={t("New here? The basics")}>
                <Term icon="th" name="Workspace">
                    the virtual bed of your machine, drawn to real size on the right
                    (the grid). Documents, generated toolpaths and the live position
                    cursor all live there. The <em>Workspace</em> toolbar above saves
                    or restores everything as a snapshot file.
                </Term>
                <Term icon="file-image-o" name="Document">
                    a design file you import with <em>Add Document</em>. Its type decides
                    the workflow branch: <strong>vector</strong> (SVG, DXF — paths and
                    curves) or <strong>raster</strong> (PNG, JPG, BMP — a grid of pixels).
                    Ready-made <code>.gcode</code> files can also be loaded directly.
                </Term>
                <Term icon="file-code-o" name="G-code">
                    the machine's own language, and where both branches end: a plain-text
                    list of moves and tool commands (<code>G0</code>/<code>G1</code> to
                    travel, <code>M3</code>/<code>M4</code>/<code>M5</code> tool on/off,{' '}
                    <code>S</code> for power).
                </Term>
            </GuideCard>

            <GuideCard storageKey="flow" bsStyle="success" icon="road" title={t("The workflow, phase by phase")}>
                <Phase n="1" title="Raster or vector?">
                    <p style={{ marginBottom: 4 }}>
                        Look at your source file — it decides the branch:
                    </p>
                    <Branch letter="1A" bsStyle="info" icon="pencil" title="Vector (SVG, DXF)">
                        <p style={{ marginBottom: 4 }}>
                            Paths and curves. The head will <strong>follow your
                            drawing</strong> — this is cutting, line engraving, and pen
                            plotting.
                        </p>
                        <ol style={{ marginBottom: 0, paddingLeft: 18 }}>
                            <li><em>Add Document</em> and place it on the workspace</li>
                            <li>Drag it onto <em>Operations</em>: <em>Laser Cut</em> or <em>Laser Engrave</em></li>
                            <li>Tune feed, power and passes</li>
                        </ol>
                    </Branch>
                    <Branch letter="1B" bsStyle="warning" icon="picture-o" title="Raster (PNG, JPG, BMP)">
                        <p style={{ marginBottom: 4 }}>
                            Pixels, <strong>never vectorized</strong>. Like a printer, the
                            machine sweeps the image <strong>line by line</strong>, modulating
                            power per pixel (<code>S</code> varies continuously): dark pixels
                            burn more. This is how photos get engraved.
                        </p>
                        <ol style={{ marginBottom: 4, paddingLeft: 18 }}>
                            <li><em>Add Document</em> and place it on the workspace</li>
                            <li>Drag it onto <em>Operations</em>: <em>Laser Raster</em></li>
                            <li>Tune line spacing (resolution), speed and max power</li>
                        </ol>
                        <p style={{ marginBottom: 0 }}>
                            <Icon name="info-circle" /> <em>Pen plotters:</em> a pen cannot
                            draw "50% gray" — convert bitmaps to strokes first (hatching,
                            dithering, tracing) and take branch 1A instead.
                        </p>
                    </Branch>
                </Phase>
                <Phase n="2" title="Generate (branches converge here)">
                    <p style={{ marginBottom: 0 }}>
                        <em>Generate</em> compiles every enabled operation into a single
                        G-code program. Check the toolpath preview on the workspace — for
                        vector work you should recognize your drawing; raster shows as a
                        dense block of scanlines.
                    </p>
                </Phase>
                <Phase n="3" title="Run">
                    <p style={{ marginBottom: 0 }}>
                        Connect to the machine in <em>Comms</em>, home it, then run the
                        job and watch progress and live position in <em>Control</em>.
                    </p>
                </Phase>
            </GuideCard>
        </div>
    )
}

export default CamGuide
