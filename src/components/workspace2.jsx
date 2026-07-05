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
import { selectDocument, toggleSelectDocument, selectDocuments, removeDocumentSelected } from '../actions/document'

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

function tapToSelect(obj, docId) {
    obj.cursor = 'pointer'
    onTap(obj, e => {
        const multi = e.ctrlKey || e.metaKey || e.shiftKey
        GlobalStore().dispatch(multi ? toggleSelectDocument(docId) : selectDocument(docId))
    })
}

// Documents referenced by any operation (including their whole subtree):
// these are the ones that will actually produce G-code.
export function computeAttachedIds(documents, operations) {
    const byId = new Map(documents.map(d => [d.id, d]))
    const attached = new Set()
    const mark = (id) => {
        if (attached.has(id)) return
        attached.add(id)
        const d = byId.get(id)
        if (d && d.children) for (const c of d.children) mark(c)
    }
    for (const op of operations)
        for (const id of (op.documents || [])) mark(id)
    return attached
}

function drawDocuments(container, documents, attachedIds, layers) {
    container.removeChildren().forEach(c => c.destroy())
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
            sprite.alpha = (doc.selected ? 0.75 : 1) * layerAlpha
            Assets.load(doc.dataURL)
                .then(tex => {
                    if (sprite.destroyed) return
                    sprite.texture = tex
                    // Plain image documents (positive d) map pixel-y straight to
                    // mm-y; the legacy engine flips the texture V in its shader
                    // instead. Mirror locally so they don't render upside down.
                    // SVG-embedded images bake the flip into transform2d (d < 0).
                    if (t[3] > 0)
                        sprite.setFromMatrix(new Matrix(...t).append(new Matrix(1, 0, 0, -1, 0, tex.height)))
                })
                .catch(err => console.warn('[workspace2] image load failed:', err))
            tapToSelect(sprite, doc.id)
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
            tapToSelect(g, doc.id)
            if (doc.selected) {
                g.rect(x1 - 2, y1 - 2, (x2 - x1) + 4, (y2 - y1) + 4)
                    .stroke({ width: 1, color: COLORS.docSelected, alpha: 0.9, pixelLine: true })
            }
        }
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

export function Workspace2({ style }) {
    const holderRef = useRef(null)
    const pixiRef = useRef(null)
    const [ready, setReady] = useState(0)

    const documents = useSelector(s => s.documents)
    const operations = useSelector(s => s.operations)
    const gcode = useSelector(s => s.gcode.content)
    const machineWidth = useSelector(s => Number(s.settings.machineWidth) || 300)
    const machineHeight = useSelector(s => Number(s.settings.machineHeight) || 200)

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
                const cursorG = new Graphics()
                drawCursor(cursorG)
                world.addChild(gridG, docsC, gcodeG, cursorG)

                // tap on empty bed = deselect (documents sit above and win)
                onTap(gridG, () => GlobalStore().dispatch(selectDocuments(false)))

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

                pixiRef.current = { app, viewport, world, gridG, docsC, gcodeG, cursorG }
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
        drawDocuments(p.docsC, documents, computeAttachedIds(documents, operations), layers)
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

    const chip = (key, color, label, title) => (
        <button key={key} onClick={() => toggleLayer(key)} title={title}
            style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '3px 10px', borderRadius: 12, fontSize: 12,
                border: '1px solid #c6ccd8', cursor: 'pointer',
                background: layers[key] ? '#fff' : '#e8eaef',
                color: layers[key] ? '#22262c' : '#9aa1ad',
                textDecoration: layers[key] ? 'none' : 'line-through',
            }}>
            <span style={{
                width: 10, height: 10, borderRadius: 5, background: color,
                opacity: layers[key] ? 1 : 0.35,
            }} />
            {label}
        </button>
    )

    return (
        <div style={{ ...style, overflow: 'hidden' }}>
            <div ref={holderRef} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
                title="Workspace 2.0 (PixiJS prototype) — drag to pan, wheel to zoom, click to select" />
            <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 2, display: 'flex', gap: 6 }}>
                {chip('loaded', '#9aa1ad', 'loaded', 'Documents not attached to any operation (dimmed): they will NOT produce G-code')}
                {chip('added', '#22262c', 'in operations', 'Documents attached to an operation: this is what will actually cut')}
                {chip('gcode', '#ffa94d', 'G-code', 'Generated toolpath preview: grey rapids, amber cutting moves')}
            </div>
            {selectedDocs.length > 0 &&
                <div style={{
                    position: 'absolute', left: 10, bottom: 10, zIndex: 2,
                    padding: '4px 10px', borderRadius: 12, fontSize: 12,
                    background: 'rgba(31,111,208,.92)', color: '#fff',
                    boxShadow: '0 1px 4px rgba(0,0,0,.3)', pointerEvents: 'none',
                }}>
                    {selectedDocs.length === 1
                        ? (selectedDocs[0].name || 'object')
                        : `${selectedDocs.length} objects`}
                    <span style={{ opacity: 0.75 }}> — ⌫ delete</span>
                </div>}
        </div>
    )
}

export default Workspace2
