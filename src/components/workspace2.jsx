/**
 * Workspace 2.0 — PixiJS v8 prototype of the workspace view, living side by
 * side with the legacy hand-rolled WebGL engine (toggle button, top right).
 *
 * Renders from the same redux state as the old workspace:
 *   - machine bed + grid from settings (machineWidth/machineHeight, mm)
 *   - vector documents (rawPaths transformed by transform2d)
 *   - live machine position cursor (workspace.cursorPos)
 *
 * View-only for now: pan / wheel-zoom / pinch via pixi-viewport. Selection,
 * dragging, images and G-code preview are next milestones.
 * @module
 */

import React, { useEffect, useRef, useState } from 'react'
import { useSelector } from 'react-redux'
import { Application, Assets, Container, Graphics, Matrix, Rectangle, Sprite } from 'pixi.js'
import { Viewport } from 'pixi-viewport'

import { GlobalStore } from '../index'
import { selectDocument, toggleSelectDocument, selectDocuments, removeDocumentSelected, transform2dSelectedDocuments } from '../actions/document'
import { selectPane } from '../actions/panes'
import { translateM, scaleAbout, rotateAbout, computeAttachedIds } from '../lib/doc-bounds'
import Inspector2 from './inspector2'
import { t } from '../lib/i18n'

const COLORS = {
    background: 0xeef0f4,
    bed: 0xffffff,
    gridMinor: 0xe2e5eb,
    gridMajor: 0xc6ccd8,
    bedBorder: 0x3d8fe0,
    origin: 0x2f9e5f,
    cursor: 0xd93a36,
    docDefault: 0x22262c,
    docSelected: 0x1f6fd0,
}

function colorOf(doc) {
    if (doc.selected) return COLORS.docSelected
    const c = doc.strokeColor
    if (!c) return COLORS.docDefault
    return (Math.round(c[0] * 255) << 16) | (Math.round(c[1] * 255) << 8) | Math.round(c[2] * 255)
}

// mat2d [a, b, c, d, e, f] applied to a flat [x0, y0, x1, y1, ...] array
function transformPath(path, t) {
    const out = new Array(path.length)
    for (let i = 0; i < path.length; i += 2) {
        const x = path[i], y = path[i + 1]
        out[i] = t[0] * x + t[2] * y + t[4]
        out[i + 1] = t[1] * x + t[3] * y + t[5]
    }
    return out
}

function drawGrid(g, w, h) {
    g.clear()
    g.rect(0, 0, w, h).fill(COLORS.bed)
    for (let x = 0; x <= w; x += 10) {
        g.moveTo(x, 0).lineTo(x, h)
        if (x % 50) g.stroke({ width: 1, color: COLORS.gridMinor, pixelLine: true })
        else g.stroke({ width: 1, color: COLORS.gridMajor, pixelLine: true })
    }
    for (let y = 0; y <= h; y += 10) {
        g.moveTo(0, y).lineTo(w, y)
        if (y % 50) g.stroke({ width: 1, color: COLORS.gridMinor, pixelLine: true })
        else g.stroke({ width: 1, color: COLORS.gridMajor, pixelLine: true })
    }
    g.rect(0, 0, w, h).stroke({ width: 1, color: COLORS.bedBorder, pixelLine: true })
    // origin marker (machine 0,0 — bottom-left in machine coords)
    g.moveTo(0, 0).lineTo(8, 0).moveTo(0, 0).lineTo(0, 8)
        .stroke({ width: 2, color: COLORS.origin, pixelLine: true })
    g.circle(0, 0, 2).fill(COLORS.origin)
}

// Dashed rectangle path (Graphics has no native dash); offset shifts the
// pattern start so two passes can interleave colors (marching ants).
function dashedRectPath(g, x1, y1, x2, y2, dash, gap, offset = 0) {
    const edges = [[x1, y1, x2, y1], [x2, y1, x2, y2], [x2, y2, x1, y2], [x1, y2, x1, y1]]
    for (const [ax, ay, bx, by] of edges) {
        const len = Math.hypot(bx - ax, by - ay)
        if (!len) continue
        const ux = (bx - ax) / len, uy = (by - ay) / len
        for (let t = offset; t < len; t += dash + gap) {
            const e = Math.min(t + dash, len)
            if (e <= t) continue
            g.moveTo(ax + ux * t, ay + uy * t).lineTo(ax + ux * e, ay + uy * e)
        }
    }
}

// Selection overlay: blue/white alternating dashes, sized in screen pixels
// (redrawn on zoom) so it never reads as document geometry.
function drawSelection(g, boundsList, scale) {
    g.clear()
    const s = Math.max(scale, 0.001)
    const pad = 4 / s, dash = 6 / s
    for (const b of boundsList) {
        if (!b.selected) continue
        const x1 = b.x1 - pad, y1 = b.y1 - pad, x2 = b.x2 + pad, y2 = b.y2 + pad
        dashedRectPath(g, x1, y1, x2, y2, dash, dash, 0)
        g.stroke({ width: 2, color: COLORS.docSelected, pixelLine: true })
        dashedRectPath(g, x1, y1, x2, y2, dash, dash, dash)
        g.stroke({ width: 2, color: 0xffffff, pixelLine: true })
    }
}

// Combined bounds of the selected entries in the bounds list
function selectedBox(boundsList) {
    let b = null
    for (const e of boundsList) {
        if (!e.selected) continue
        if (!b) b = { x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2 }
        else {
            b.x1 = Math.min(b.x1, e.x1); b.y1 = Math.min(b.y1, e.y1)
            b.x2 = Math.max(b.x2, e.x2); b.y2 = Math.max(b.y2, e.y2)
        }
    }
    return b
}

// Figma-style handles: 8 resize squares + a rotate knob above the top edge.
// Sizes are screen-constant (divided by zoom scale); redrawn on zoom and on
// every selection change. Each handle starts a gesture on pointerdown.
function drawHandles(container, boundsList, scale, startGesture) {
    container.removeChildren().forEach(c => c.destroy())
    const b = selectedBox(boundsList)
    if (!b) return
    const s = Math.max(scale, 0.001)
    const pad = 4 / s, hs = 5 / s
    const x1 = b.x1 - pad, y1 = b.y1 - pad, x2 = b.x2 + pad, y2 = b.y2 + pad
    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2
    // world is y-up: y2 is the visual top
    const spots = [
        { dir: 'nw', x: x1, y: y2, cursor: 'nwse-resize', anchor: { x: x2, y: y1 } },
        { dir: 'n', x: cx, y: y2, cursor: 'ns-resize', anchor: { x: cx, y: y1 }, axis: 'y' },
        { dir: 'ne', x: x2, y: y2, cursor: 'nesw-resize', anchor: { x: x1, y: y1 } },
        { dir: 'e', x: x2, y: cy, cursor: 'ew-resize', anchor: { x: x1, y: cy }, axis: 'x' },
        { dir: 'se', x: x2, y: y1, cursor: 'nwse-resize', anchor: { x: x1, y: y2 } },
        { dir: 's', x: cx, y: y1, cursor: 'ns-resize', anchor: { x: cx, y: y2 }, axis: 'y' },
        { dir: 'sw', x: x1, y: y1, cursor: 'nesw-resize', anchor: { x: x2, y: y2 } },
        { dir: 'w', x: x1, y: cy, cursor: 'ew-resize', anchor: { x: x2, y: cy }, axis: 'x' },
    ]
    for (const spot of spots) {
        const h = new Graphics()
        h.rect(spot.x - hs, spot.y - hs, hs * 2, hs * 2)
            .fill(0xffffff)
            .stroke({ width: 1.5, color: COLORS.docSelected, pixelLine: true })
        h.eventMode = 'static'
        h.cursor = spot.cursor
        // generous hit area: the square is tiny at high zoom-out
        h.hitArea = new Rectangle(spot.x - hs * 1.6, spot.y - hs * 1.6, hs * 3.2, hs * 3.2)
        h.on('pointerdown', e => startGesture(e, 'resize', { anchor: spot.anchor, axis: spot.axis || null }))
        container.addChild(h)
    }
    // rotate knob above the top edge, with a stem
    const ry = y2 + 16 / s
    const rot = new Graphics()
    rot.moveTo(cx, y2).lineTo(cx, ry).stroke({ width: 1.5, color: COLORS.docSelected, pixelLine: true })
    rot.circle(cx, ry, hs * 1.2).fill(0xffffff).stroke({ width: 1.5, color: COLORS.docSelected, pixelLine: true })
    rot.eventMode = 'static'
    rot.cursor = 'grab'
    rot.hitArea = new Rectangle(cx - hs * 2, ry - hs * 2, hs * 4, hs * 4)
    rot.on('pointerdown', e => startGesture(e, 'rotate', { center: { x: cx, y: cy } }))
    container.addChild(rot)
}

// A tap is a press+release that barely moved — a viewport pan gesture that
// happens to start on an object must not select it.
function onTap(obj, handler) {
    obj.eventMode = 'static'
    obj.on('pointerdown', e => { obj.__tapStart = { x: e.global.x, y: e.global.y } })
    obj.on('pointerup', e => {
        const s = obj.__tapStart
        obj.__tapStart = null
        if (s && Math.hypot(e.global.x - s.x, e.global.y - s.y) < 6) handler(e)
    })
}

// Documents select on pointer-down and then drag to move (the empty bed
// still pans the viewport; stopPropagation keeps the pan plugin out).
function makeDocInteractive(obj, docId, onDocDown) {
    obj.eventMode = 'static'
    obj.cursor = 'move'
    obj.__docId = docId
    obj.on('pointerdown', e => onDocDown(e, docId))
}

// re-exported for legacy importers (document.jsx); lives in lib/doc-bounds
export { computeAttachedIds }

function drawDocuments(container, documents, attachedIds, layers, boundsList, onBoundsChange, onDocDown) {
    container.removeChildren().forEach(c => c.destroy())
    boundsList.length = 0
    for (const doc of documents) {
        if (doc.visible === false) continue
        const attached = attachedIds.has(doc.id)
        if (attached && !layers.added) continue
        if (!attached && !layers.loaded) continue
        // loaded-but-unattached documents render dimmed: they will not cut
        const layerAlpha = attached ? 1 : 0.4
        // raster documents: a sprite placed by its transform2d matrix, which
        // maps image pixels (y-down) to workspace mm (y-up)
        if (doc.dataURL && doc.transform2d) {
            const sprite = new Sprite()
            const t = doc.transform2d
            sprite.setFromMatrix(new Matrix(...t))
            // remember the full placement matrix so gestures (move / resize /
            // rotate) can preview as gestureMatrix ∘ base without losing it
            sprite.__baseM = new Matrix(...t)
            sprite.alpha = (doc.selected ? 0.75 : 1) * layerAlpha
            Assets.load(doc.dataURL)
                .then(tex => {
                    if (sprite.destroyed) return
                    sprite.texture = tex
                    // Plain image documents (positive d) map pixel-y straight to
                    // mm-y; the legacy engine flips the texture V in its shader
                    // instead. Mirror locally so they don't render upside down.
                    // SVG-embedded images bake the flip into transform2d (d < 0).
                    let m = new Matrix(...t)
                    if (t[3] > 0) m = m.append(new Matrix(1, 0, 0, -1, 0, tex.height))
                    sprite.setFromMatrix(m)
                    sprite.__baseM = m.clone()
                    const pts = [[0, 0], [tex.width, 0], [0, tex.height], [tex.width, tex.height]]
                        .map(([px, py]) => m.apply({ x: px, y: py }))
                    boundsList.push({
                        selected: doc.selected,
                        x1: Math.min(...pts.map(p => p.x)), x2: Math.max(...pts.map(p => p.x)),
                        y1: Math.min(...pts.map(p => p.y)), y2: Math.max(...pts.map(p => p.y)),
                    })
                    if (onBoundsChange) onBoundsChange()
                })
                .catch(err => console.warn('[workspace2] image load failed:', err))
            makeDocInteractive(sprite, doc.id, onDocDown)
            container.addChild(sprite)
            continue
        }
        if (!doc.rawPaths || !doc.transform2d) continue
        const g = new Graphics()
        const color = colorOf(doc)
        let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
        for (const raw of doc.rawPaths) {
            const p = transformPath(raw, doc.transform2d)
            if (p.length < 4) continue
            g.moveTo(p[0], p[1])
            for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1])
            g.stroke({ width: 1, color, alpha: layerAlpha, pixelLine: true })
            for (let i = 0; i < p.length; i += 2) {
                if (p[i] < x1) x1 = p[i]
                if (p[i] > x2) x2 = p[i]
                if (p[i + 1] < y1) y1 = p[i + 1]
                if (p[i + 1] > y2) y2 = p[i + 1]
            }
        }
        if (x1 < x2) {
            // hairline strokes are unclickable; select by bounding box
            g.hitArea = new Rectangle(x1, y1, x2 - x1, y2 - y1)
            makeDocInteractive(g, doc.id, onDocDown)
            boundsList.push({ selected: doc.selected, x1, y1, x2, y2 })
        }
        g.__baseM = new Matrix() // geometry baked in world mm; base = identity
        container.addChild(g)
    }
}

// Minimal modal G-code walk for previewing: G0/G1 (G2/G3 approximated as
// straight lines for now), G90/G91, X/Y/S words and M3/M4/M5. Returns flat
// segment arrays split into rapids (laser off) and cuts (laser on, S > 0).
export function parseGcodePreview(gcode) {
    const rapids = []
    const cuts = []
    let x = 0, y = 0, mode = 1, power = 0, laserOn = false, relative = false
    for (const rawLine of gcode.split(/\r?\n/)) {
        const line = rawLine.split(';')[0].trim().toUpperCase()
        if (!line) continue
        let newX = null, newY = null
        for (const tok of line.match(/[A-Z][-+]?[0-9.]*/g) || []) {
            const val = parseFloat(tok.slice(1))
            switch (tok[0]) {
                case 'G':
                    if (val === 90) relative = false
                    else if (val === 91) relative = true
                    else if (val >= 0 && val <= 3) mode = val
                    break
                case 'X': newX = relative ? x + val : val; break
                case 'Y': newY = relative ? y + val : val; break
                case 'S': power = val; break
                case 'M':
                    if (val === 3 || val === 4) laserOn = true
                    else if (val === 5) laserOn = false
                    break
            }
        }
        if (newX !== null || newY !== null) {
            const nx = newX !== null ? newX : x
            const ny = newY !== null ? newY : y
            const cutting = mode !== 0 && laserOn && power > 0
            ;(cutting ? cuts : rapids).push(x, y, nx, ny)
            x = nx
            y = ny
        }
    }
    return { rapids, cuts }
}

function drawGcode(g, gcode) {
    g.clear()
    if (!gcode) return
    const { rapids, cuts } = parseGcodePreview(gcode)
    for (let i = 0; i < rapids.length; i += 4)
        g.moveTo(rapids[i], rapids[i + 1]).lineTo(rapids[i + 2], rapids[i + 3])
    if (rapids.length) g.stroke({ width: 1, color: 0x5a6478, alpha: 0.7, pixelLine: true })
    for (let i = 0; i < cuts.length; i += 4)
        g.moveTo(cuts[i], cuts[i + 1]).lineTo(cuts[i + 2], cuts[i + 3])
    if (cuts.length) g.stroke({ width: 1, color: 0xffa94d, pixelLine: true })
}

function drawCursor(g) {
    g.clear()
    g.moveTo(-6, 0).lineTo(6, 0).moveTo(0, -6).lineTo(0, 6)
        .stroke({ width: 1.5, color: COLORS.cursor, pixelLine: true })
    g.circle(0, 0, 3).stroke({ width: 1.5, color: COLORS.cursor, pixelLine: true })
}

// Slim vertical pipeline: where am I in the docs → ops → gcode → run flow?
// Each step navigates to the pane where that phase happens.
function PipelineRail({ documents, operations, gcode, gcodeDirty, playing }) {
    const steps = [
        { label: 'Docs', done: documents.length > 0, pane: 'cam', title: t('Documents loaded — click to open Files') },
        { label: 'Ops', done: operations.length > 0, pane: 'cam', title: t('Operations defined — click to open Files') },
        { label: 'G-code', done: !!gcode && !gcodeDirty, warn: !!gcode && gcodeDirty, pane: 'cam', title: gcodeDirty ? t('G-code is stale — regenerate in Files') : t('G-code generated — click to open Files') },
        { label: 'Run', done: playing, pane: 'jog', title: t('Run from the Control pane') },
    ]
    const current = steps.findIndex(s => !s.done)
    return (
        <div style={{ width: 54, flex: '0 0 auto', background: 'var(--fp-panel)', borderRight: '1px solid var(--fp-border)', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 0' }}>
            {steps.map((s, i) => (
                <React.Fragment key={s.label}>
                    {i > 0 && <div style={{ width: 2, height: 11, background: steps[i - 1].done ? 'var(--fp-go-line)' : 'var(--fp-border-input)' }} />}
                    <div title={s.title} onClick={() => GlobalStore().dispatch(selectPane(s.pane))}
                        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer' }}>
                        <div style={{
                            width: 30, height: 30, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12,
                            background: i === current ? 'var(--fp-go)' : 'var(--fp-surface)',
                            color: i === current ? '#fff' : (s.warn ? 'var(--fp-amber-deep)' : (s.done ? 'var(--fp-go-deep)' : 'var(--fp-text-muted)')),
                            border: i === current ? 'none' : `1px solid ${s.warn ? 'var(--fp-amber-line)' : (s.done ? 'var(--fp-go-line)' : 'var(--fp-border-input)')}`,
                            boxShadow: i === current ? '0 2px 6px oklch(0.56 0.13 152 / 0.35)' : 'none',
                        }}>{s.done ? '✓' : (s.warn ? '!' : i + 1)}</div>
                        <span style={{ fontSize: 8.5, margin: '3px 0', color: i === current ? 'var(--fp-go-deep)' : 'var(--fp-text-muted)', fontWeight: i === current ? 600 : 400 }}>{s.label}</span>
                    </div>
                </React.Fragment>
            ))}
        </div>
    )
}

export function Workspace2({ style }) {
    const holderRef = useRef(null)
    const pixiRef = useRef(null)
    const boundsRef = useRef([])
    const [ready, setReady] = useState(0)

    const documents = useSelector(s => s.documents)
    const operations = useSelector(s => s.operations)
    const gcode = useSelector(s => s.gcode.content)
    const gcodeDirty = useSelector(s => s.gcode.dirty)
    const machineWidth = useSelector(s => Number(s.settings.machineWidth) || 300)
    const machineHeight = useSelector(s => Number(s.settings.machineHeight) || 200)
    const cursorPos = useSelector(s => s.workspace.cursorPos)
    const machineConnected = useSelector(s => s.com.machineConnected)
    const playing = useSelector(s => s.com.playing)

    const [layers, setLayers] = useState(() => {
        try {
            return { loaded: true, added: true, gcode: true, ...JSON.parse(window.localStorage.getItem('LaserWeb.ws2.layers')) }
        } catch (e) {
            return { loaded: true, added: true, gcode: true }
        }
    })
    const toggleLayer = (key) => {
        const next = { ...layers, [key]: !layers[key] }
        window.localStorage.setItem('LaserWeb.ws2.layers', JSON.stringify(next))
        setLayers(next)
    }

    // one-time init / teardown
    useEffect(() => {
        let cancelled = false
        const holder = holderRef.current
        const app = new Application()

        app.init({ resizeTo: holder, background: COLORS.background, antialias: true })
            .then(() => {
                if (cancelled) { app.destroy(true, { children: true }); return }
                holder.appendChild(app.canvas)

                const viewport = new Viewport({
                    screenWidth: holder.clientWidth,
                    screenHeight: holder.clientHeight,
                    worldWidth: machineWidth,
                    worldHeight: machineHeight,
                    events: app.renderer.events,
                })
                app.stage.addChild(viewport)
                viewport.drag().pinch().wheel().decelerate()
                    .clampZoom({ minScale: 0.2, maxScale: 60 })

                // machine coordinates are Y-up; flip the world inside the viewport
                const world = new Container()
                world.scale.y = -1
                world.position.y = machineHeight
                viewport.addChild(world)

                const gridG = new Graphics()
                const docsC = new Container()
                const gcodeG = new Graphics()
                const selG = new Graphics()
                const handlesC = new Container()
                const cursorG = new Graphics()
                drawCursor(cursorG)
                world.addChild(gridG, docsC, gcodeG, selG, handlesC, cursorG)

                // tap on empty bed = deselect (documents sit above and win)
                onTap(gridG, () => GlobalStore().dispatch(selectDocuments(false)))

                // --- gesture engine: move / resize / rotate preview live on
                // the pixi objects (gestureMatrix ∘ base), then commit as ONE
                // transform2dSelectedDocuments dispatch on release ------------
                const gesture = { active: false, kind: null, mat: null, start: null, anchor: null, axis: null, center: null }
                const startGesture = (e, kind, opts = {}) => {
                    e.stopPropagation() // keep the viewport pan plugin out
                    const p = world.toLocal(e.global)
                    Object.assign(gesture, { active: true, kind, mat: null, start: { x: p.x, y: p.y } }, opts)
                }
                const applyPreview = (m) => {
                    gesture.mat = m
                    const M = new Matrix(...m)
                    const selected = new Set(GlobalStore().getState().documents
                        .filter(d => d.selected).map(d => d.id))
                    for (const c of docsC.children)
                        if (selected.has(c.__docId))
                            c.setFromMatrix(M.clone().append(c.__baseM || new Matrix()))
                    selG.setFromMatrix(M)
                    handlesC.setFromMatrix(M)
                }
                const onDocDown = (e, docId) => {
                    const st = GlobalStore().getState()
                    const doc = st.documents.find(d => d.id === docId)
                    if (e.ctrlKey || e.metaKey || e.shiftKey) {
                        e.stopPropagation()
                        GlobalStore().dispatch(toggleSelectDocument(docId))
                        return
                    }
                    if (!doc || !doc.selected) GlobalStore().dispatch(selectDocument(docId))
                    startGesture(e, 'move')
                }
                app.stage.eventMode = 'static'
                app.stage.hitArea = app.screen
                const clampScale = (v) => Math.max(0.01, Math.abs(v)) // no flips through handles
                app.stage.on('globalpointermove', (e) => {
                    if (!gesture.active) return
                    const p = world.toLocal(e.global)
                    const { start, anchor, axis, center, kind } = gesture
                    let m = null
                    if (kind === 'move') {
                        m = translateM(p.x - start.x, p.y - start.y)
                    } else if (kind === 'resize') {
                        if (axis === 'x') {
                            const d0 = start.x - anchor.x
                            m = scaleAbout(d0 ? clampScale((p.x - anchor.x) / d0) : 1, 1, anchor.x, anchor.y)
                        } else if (axis === 'y') {
                            const d0 = start.y - anchor.y
                            m = scaleAbout(1, d0 ? clampScale((p.y - anchor.y) / d0) : 1, anchor.x, anchor.y)
                        } else {
                            // corners scale uniformly by distance to the anchor
                            const d0 = Math.hypot(start.x - anchor.x, start.y - anchor.y)
                            const s = clampScale(Math.hypot(p.x - anchor.x, p.y - anchor.y) / Math.max(d0, 1e-6))
                            m = scaleAbout(s, s, anchor.x, anchor.y)
                        }
                    } else if (kind === 'rotate') {
                        let th = Math.atan2(p.y - center.y, p.x - center.x)
                            - Math.atan2(start.y - center.y, start.x - center.x)
                        if (e.shiftKey) th = Math.round(th / (Math.PI / 12)) * (Math.PI / 12) // 15° snap
                        m = rotateAbout(th, center.x, center.y)
                    }
                    if (m) applyPreview(m)
                })
                const endGesture = () => {
                    if (!gesture.active) return
                    const m = gesture.mat
                    gesture.active = false
                    gesture.mat = null
                    for (const c of docsC.children)
                        if (c.__baseM) c.setFromMatrix(c.__baseM)
                    selG.setFromMatrix(new Matrix())
                    handlesC.setFromMatrix(new Matrix())
                    if (!m) return
                    const changed = Math.abs(m[0] - 1) > 1e-4 || Math.abs(m[1]) > 1e-4
                        || Math.abs(m[2]) > 1e-4 || Math.abs(m[3] - 1) > 1e-4
                        || Math.hypot(m[4], m[5]) > 0.01
                    if (changed) GlobalStore().dispatch(transform2dSelectedDocuments(m))
                }
                app.stage.on('pointerup', endGesture)
                app.stage.on('pointerupoutside', endGesture)

                // dash/handle sizes are screen-relative: refresh on zoom
                const refreshOverlay = () => {
                    drawSelection(selG, boundsRef.current, viewport.scale.x)
                    drawHandles(handlesC, boundsRef.current, viewport.scale.x, startGesture)
                }
                viewport.on('zoomed', refreshOverlay)

                // fit the bed with a margin
                const s = Math.min(
                    holder.clientWidth / (machineWidth * 1.1),
                    holder.clientHeight / (machineHeight * 1.1))
                viewport.setZoom(s, true)
                viewport.moveCenter(machineWidth / 2, machineHeight / 2)

                // live machine cursor straight from the store — no React churn
                app.ticker.add(() => {
                    const st = GlobalStore().getState()
                    const pos = st.workspace.cursorPos
                    const connected = st.com.machineConnected
                    cursorG.visible = !!(connected && pos)
                    if (pos) { cursorG.position.set(pos[0] || 0, pos[1] || 0) }
                })

                app.renderer.on('resize', (w, h) => viewport.resize(w, h))

                pixiRef.current = { app, viewport, world, gridG, docsC, gcodeG, selG, handlesC, cursorG, onDocDown, refreshOverlay }
                setReady(r => r + 1)
            })
            .catch(err => console.error('[workspace2] init failed:', err))

        return () => {
            cancelled = true
            const p = pixiRef.current
            pixiRef.current = null
            if (p) p.app.destroy(true, { children: true })
        }
    }, [])

    // bed / grid follows machine profile changes
    useEffect(() => {
        const p = pixiRef.current
        if (!p) return
        drawGrid(p.gridG, machineWidth, machineHeight)
        p.world.position.y = machineHeight
        p.viewport.worldWidth = machineWidth
        p.viewport.worldHeight = machineHeight
    }, [ready, machineWidth, machineHeight])

    // documents re-render on any document/operation/layer change
    useEffect(() => {
        const p = pixiRef.current
        if (!p) return
        drawDocuments(p.docsC, documents, computeAttachedIds(documents, operations), layers,
            boundsRef.current, p.refreshOverlay, p.onDocDown)
        p.refreshOverlay()
    }, [ready, documents, operations, layers])

    // G-code toolpath preview: grey = rapids, amber = cutting moves
    useEffect(() => {
        const p = pixiRef.current
        if (!p) return
        p.gcodeG.visible = layers.gcode
        drawGcode(p.gcodeG, gcode)
    }, [ready, gcode, layers])

    // Backspace / Delete removes the selected documents (unless typing)
    useEffect(() => {
        const onKey = (e) => {
            if (e.key !== 'Delete' && e.key !== 'Backspace') return
            const t = e.target
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
            if (!GlobalStore().getState().documents.some(d => d.selected)) return
            e.preventDefault() // Backspace must not navigate back
            GlobalStore().dispatch(removeDocumentSelected())
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [])

    const selectedDocs = documents.filter(d => d.selected)
    const single = selectedDocs.length === 1 ? selectedDocs[0] : null
    const [cx, cy] = (cursorPos || []).map(Number)

    const layerChip = (key, label, title) => (
        <button key={key} onClick={() => toggleLayer(key)} title={title}
            style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '5px 9px', borderRadius: 8, fontSize: 11, fontWeight: 600,
                cursor: 'pointer', whiteSpace: 'nowrap',
                border: `1px solid ${layers[key] ? 'var(--fp-border-input)' : 'transparent'}`,
                background: layers[key] ? 'var(--fp-surface)' : 'transparent',
                color: layers[key] ? 'var(--fp-text)' : 'var(--fp-text-muted)',
                opacity: layers[key] ? 1 : 0.55,
                textDecoration: layers[key] ? 'none' : 'line-through',
            }}>
            {label}
        </button>
    )

    return (
        <div style={{ ...style, overflow: 'hidden', display: 'flex', background: 'var(--fp-bg)', fontFamily: 'var(--fp-font)' }}>
            <PipelineRail documents={documents} operations={operations} gcode={gcode} gcodeDirty={gcodeDirty} playing={playing} />

            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                {/* CanvasToolbar — right side stays clear of the floating switcher buttons */}
                <div style={{ height: 40, flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8, padding: '0 200px 0 12px', borderBottom: '1px solid var(--fp-border)', background: 'var(--fp-surface)' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--fp-text-muted)', letterSpacing: '0.05em' }}>{t('LAYERS')}</span>
                    {layerChip('loaded', `◱ ${t('Documents')}`, t('Documents not attached to any operation (dimmed): they will NOT produce G-code'))}
                    {layerChip('added', `◼ ${t('In operation')}`, t('Documents attached to an operation: this is what will actually cut'))}
                    {layerChip('gcode', `〰 ${t('G-code preview')}`, t('Generated toolpath preview: grey rapids, amber cutting moves'))}
                </div>

                <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
                    <div ref={holderRef} style={{ position: 'absolute', inset: 0 }}
                        title={t('Drag to pan, wheel to zoom, click to select. Handles resize (corners keep proportion) and rotate (shift snaps 15°).')} />
                </div>

                {/* StatusBar */}
                <div style={{ height: 26, flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 12, padding: '0 12px', background: 'var(--fp-surface)', borderTop: '1px solid var(--fp-border)', fontSize: 10.5, color: 'var(--fp-text-muted)', fontFamily: 'var(--fp-mono)', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {selectedDocs.length === 0 ? t('no selection')
                            : (single ? `sel: ${single.name || t('object')}` : `sel: ${selectedDocs.length} ${t('objects')}`)}
                    </span>
                    {machineConnected && isFinite(cx) &&
                        <span>{t('cursor')} {cx.toFixed(1)}, {cy.toFixed(1)} mm</span>}
                    <span style={{ flex: 1 }} />
                    <span>{documents.filter(d => d.isRoot).length} docs · {operations.length} ops</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 12, borderTop: '2px dashed var(--fp-accent)' }} /> {t('selection')}</span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 12, borderTop: '2px solid var(--fp-amber)' }} /> G-code</span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, border: '2px solid var(--fp-danger)', borderRadius: '50%' }} /> {t('machine')}</span>
                    </span>
                    <span style={{ color: machineConnected ? 'var(--fp-go-deep)' : 'var(--fp-text-muted)' }}>
                        ● {machineConnected ? t('connected') : t('machine disconnected')}
                    </span>
                </div>
            </div>

            <Inspector2 />
        </div>
    )
}

export default Workspace2
