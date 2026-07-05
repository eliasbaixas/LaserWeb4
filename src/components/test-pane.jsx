/**
 * Test pane: fire calibration shapes (square / triangle / circle) at a
 * chosen power, or a whole power series (10..100%) laid out side by side —
 * the classic material test. Shapes are drawn in relative coordinates
 * starting at the current machine position, so jog to a safe spot first.
 *
 * SAFETY: running a test FIRES THE LASER. The run buttons stay disabled
 * until the arm checkbox is ticked, and it never persists.
 * @module
 */

import React, { useState } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { Button, ButtonGroup, Alert } from 'react-bootstrap'

import Icon from './font-awesome'
import { runJob, runCommand } from './com'
import { loadSVG } from './cam'
import { loadDocument } from '../actions/document'
import CommandHistory from './command-history'

export const TEST_POWERS = [10, 20, 40, 50, 75, 100]

// Minimal SVG for a basic shape, with physical (mm) sizing so the parser
// places it at true scale on the workspace.
export function shapeSvg(shape, size) {
    const s = Number(size)
    const h = +(s * 0.866).toFixed(3)
    const body = {
        square: `<rect x="0" y="0" width="${s}" height="${s}"/>`,
        triangle: `<polygon points="0,${h} ${s},${h} ${s / 2},0"/>`,
        circle: `<circle cx="${s / 2}" cy="${s / 2}" r="${s / 2}"/>`,
    }[shape]
    const height = shape === 'triangle' ? h : s
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}mm" height="${height}mm" viewBox="0 0 ${s} ${height}">`
        + `<g fill="none" stroke="#000000" stroke-width="0.1">${body}</g></svg>`
}

const SHAPES = {
    square: { label: 'Square', icon: 'square-o' },
    triangle: { label: 'Triangle', icon: 'caret-up' },
    circle: { label: 'Circle', icon: 'circle-o' },
}

// One shape at `power`% drawn from the current position (relative moves,
// laser on M4 only while tracing). Returns an array of G-code lines.
export function shapeGcode(shape, size, power, feed, sMax) {
    const s = Math.round(sMax * power / 100)
    const trace = {
        square: [
            `G1 X${size} F${feed}`,
            `G1 Y${size}`,
            `G1 X-${size}`,
            `G1 Y-${size}`,
        ],
        triangle: [
            `G1 X${size} F${feed}`,
            `G1 X-${size / 2} Y${+(size * 0.866).toFixed(3)}`,
            `G1 X-${size / 2} Y-${+(size * 0.866).toFixed(3)}`,
        ],
        circle: [
            // Full circle through the current point, centered size/2 to the +X
            `G2 X0 Y0 I${size / 2} J0 F${feed}`,
        ],
    }[shape]
    return [
        `; test: ${shape} ${size}mm @ ${power}% (S${s})`,
        'G21',
        'G91',
        `M4 S${s}`,
        ...trace,
        'M5',
    ]
}

export function testJobGcode({ shape, size, feed, sMax, powers }) {
    const gap = 5
    const lines = ['; LaserWeb test pattern', 'G21', 'G91']
    powers.forEach((power, i) => {
        lines.push(...shapeGcode(shape, size, power, feed, sMax))
        if (i < powers.length - 1)
            lines.push(`G0 X${size + gap}`) // hop to the next slot, laser off
    })
    // return to the starting point, laser off
    const span = (powers.length - 1) * (size + gap)
    if (span > 0) lines.push(`G0 X-${span}`)
    lines.push('G90')
    return lines.join('\n')
}

export function TestPane() {
    const dispatch = useDispatch()
    const machineConnected = useSelector(s => s.com.machineConnected)
    const sMax = useSelector(s => Number(s.settings.gcodeSMaxValue) || 1000)

    const [shape, setShape] = useState('square')
    const [size, setSize] = useState(20)
    const [feed, setFeed] = useState(1000)
    const [power, setPower] = useState(10)
    const [armed, setArmed] = useState(false)

    const disabled = !machineConnected || !armed

    const run = (powers) => {
        const gcode = testJobGcode({ shape, size: Number(size), feed: Number(feed), sMax, powers })
        CommandHistory.write(`Test: ${shape} ${size}mm, powers ${powers.join('/')}% (F${feed})`, CommandHistory.INFO)
        runJob(gcode)
    }

    // Injects the shape into the normal document pipeline, exactly as if an
    // SVG file of that size had been imported with Add Document.
    const addToWorkspace = async () => {
        const svg = shapeSvg(shape, size)
        const file = new File([svg], `test-${shape}-${size}mm.svg`, { type: 'image/svg+xml' })
        const result = await loadSVG(file)
        if (!result) return
        dispatch(loadDocument(file, result, {}))
        CommandHistory.write(`Added ${shape} (${size}mm) to the workspace — see it in Files`, CommandHistory.INFO)
    }

    return (
        <div style={{ overflowY: 'auto', padding: 4 }}>
            <Alert bsStyle="danger" style={{ padding: 6, marginBottom: 6, fontSize: 12 }}>
                <strong><Icon name="warning" /> This fires the laser.</strong> Wear safety
                glasses, keep the area clear and non-flammable, and jog to a free spot
                first — shapes start at the current position and grow towards +X/+Y.
            </Alert>

            <div className="well well-sm" style={{ marginBottom: 6 }}>
                <label style={{ display: 'block' }}>Shape</label>
                <ButtonGroup>
                    {Object.entries(SHAPES).map(([id, def]) =>
                        <Button key={id} bsSize="small" bsStyle={shape === id ? 'primary' : 'default'}
                            onClick={() => setShape(id)}>
                            <Icon name={def.icon} /> {def.label}
                        </Button>)}
                </ButtonGroup>

                <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                    <label>Size (mm)&nbsp;
                        <input type="number" min="1" max="100" value={size} style={{ width: 60 }}
                            onChange={e => setSize(e.target.value)} />
                    </label>
                    <label>Feed (mm/min)&nbsp;
                        <input type="number" min="1" max="6000" step="50" value={feed} style={{ width: 70 }}
                            onChange={e => setFeed(e.target.value)} />
                    </label>
                </div>

                <div style={{ marginTop: 8 }}>
                    <Button bsStyle="success" bsSize="small" onClick={addToWorkspace}
                        title="Add this shape to the workspace as an SVG document: move/resize it, drag it onto an operation and run the normal pipeline">
                        <Icon name="plus" /> Add to workspace as document
                    </Button>
                </div>

                <label style={{ display: 'block', marginTop: 8 }}>
                    Power ({Math.round(sMax * power / 100)} of S{sMax})
                </label>
                <ButtonGroup>
                    {TEST_POWERS.map(p =>
                        <Button key={p} bsSize="small" bsStyle={power === p ? 'warning' : 'default'}
                            onClick={() => setPower(p)}>
                            {p}%
                        </Button>)}
                </ButtonGroup>
            </div>

            <div className="well well-sm" style={{ marginBottom: 6 }}>
                <label style={{ color: '#a94442', cursor: 'pointer' }}>
                    <input type="checkbox" checked={armed} onChange={e => setArmed(e.target.checked)} />
                    {' '}Arm laser test {!machineConnected && <small>(machine not connected)</small>}
                </label>
                <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                    <Button bsStyle="warning" bsSize="small" disabled={disabled}
                        title={`One ${shape} at ${power}%`}
                        onClick={() => run([power])}>
                        <Icon name="play" /> Run @ {power}%
                    </Button>
                    <Button bsStyle="danger" bsSize="small" disabled={disabled}
                        title={`Six ${shape}s side by side, one per power: ${TEST_POWERS.join(', ')}%`}
                        onClick={() => run(TEST_POWERS)}>
                        <Icon name="th" /> Run series {TEST_POWERS.join('/')}%
                    </Button>
                    <Button bsStyle="default" bsSize="small"
                        title="Immediate M5 (laser off)"
                        onClick={() => runCommand('M5')}>
                        <Icon name="power-off" /> M5
                    </Button>
                </div>
            </div>

            <label style={{ marginBottom: 2 }}>G-code preview</label>
            <pre style={{ fontSize: 11, maxHeight: '30vh', overflowY: 'auto' }}>
                {testJobGcode({ shape, size: Number(size), feed: Number(feed), sMax, powers: [power] })}
            </pre>
        </div>
    )
}

export default TestPane
