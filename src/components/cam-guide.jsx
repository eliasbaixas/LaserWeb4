/**
 * Onboarding cards for the Files pane, shown while the workspace is empty
 * (no documents, no operations). One card for shared concepts plus one per
 * pipeline — vector and raster — which reach G-code in fundamentally
 * different ways. Each card collapses independently and remembers its
 * state in localStorage.
 * @module
 */

import React, { useState } from 'react'
import { useSelector } from 'react-redux'

import Icon from './font-awesome'

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
                <div className="panel-body" style={{ padding: 8, fontSize: 12, overflowY: 'auto', maxHeight: '40vh' }}>
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

export function CamGuide() {
    const empty = useSelector(s => s.documents.length === 0 && s.operations.length === 0)
    if (!empty) return null

    return (
        <div>
            <GuideCard storageKey="concepts" bsStyle="primary" icon="graduation-cap" title="New here? The basics">
                <Term icon="th" name="Workspace">
                    the virtual bed of your machine, drawn to real size on the right
                    (the grid). Documents, generated toolpaths and the live position
                    cursor all live there. The <em>Workspace</em> toolbar above saves
                    or restores everything as a snapshot file.
                </Term>
                <Term icon="file-image-o" name="Document">
                    a design file you import with <em>Add Document</em>. Its type decides
                    the pipeline below: <strong>vector</strong> (SVG, DXF — paths and
                    curves) or <strong>raster</strong> (PNG, JPG, BMP — a grid of pixels).
                    Ready-made <code>.gcode</code> files can also be loaded directly.
                </Term>
                <Term icon="file-code-o" name="G-code">
                    the machine's own language, and the end product of both pipelines: a
                    plain-text list of moves and tool commands (<code>G0</code>/<code>G1</code>{' '}
                    to travel, <code>M3</code>/<code>M4</code>/<code>M5</code> tool on/off,{' '}
                    <code>S</code> for power). <em>Generate</em> compiles your operations
                    into G-code and previews the toolpath on the workspace.
                </Term>
            </GuideCard>

            <GuideCard storageKey="vector" bsStyle="info" icon="pencil" title="Vector → CNC (SVG, DXF)">
                <p style={{ marginBottom: 6 }}>
                    The head <strong>follows the drawing's paths</strong>: outlines are
                    cut, lines are engraved — and for a pen plotter, drawn. The G-code
                    traces the same geometry you see, with the tool switched on along
                    each path and off between them.
                </p>
                <ol style={{ marginBottom: 0, paddingLeft: 20 }}>
                    <li><em>Add Document</em> (SVG/DXF) and place it on the workspace</li>
                    <li>Drag it onto <em>Operations</em>: <em>Laser Cut</em> or <em>Laser Engrave</em></li>
                    <li>Tune feed, power and passes</li>
                    <li><em>Generate</em> and check the preview — you should recognize your drawing</li>
                    <li>Connect in <em>Comms</em> and run the job</li>
                </ol>
            </GuideCard>

            <GuideCard storageKey="raster" bsStyle="warning" icon="picture-o" title="Raster → CNC (PNG, JPG, BMP)">
                <p style={{ marginBottom: 6 }}>
                    The image is <strong>not vectorized</strong>. Like a printer, the
                    machine sweeps the area <strong>line by line</strong> and modulates
                    laser power per pixel (the <code>S</code> value changes continuously
                    along each pass): dark pixels burn more, light ones less. That is how
                    photos get engraved — and why bitmaps are welcome on a laser.
                </p>
                <ol style={{ marginBottom: 6, paddingLeft: 20 }}>
                    <li><em>Add Document</em> (PNG/JPG/BMP)</li>
                    <li>Drag it onto <em>Operations</em>: <em>Laser Raster</em></li>
                    <li>Tune line spacing (resolution), speed and max power</li>
                    <li><em>Generate</em> — expect many scanlines and a large file</li>
                    <li>Connect in <em>Comms</em> and run the job</li>
                </ol>
                <p style={{ marginBottom: 0 }}>
                    <Icon name="info-circle" /> <em>Pen plotters:</em> a pen is on/off and
                    cannot burn "50% gray", so this pipeline does not apply — convert
                    bitmaps to strokes first (hatching, dithering, tracing) and feed the
                    result through the vector pipeline.
                </p>
            </GuideCard>
        </div>
    )
}

export default CamGuide
