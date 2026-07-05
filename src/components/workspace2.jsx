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
import { Application, Container, Graphics } from 'pixi.js'
import { Viewport } from 'pixi-viewport'

import { GlobalStore } from '../index'

const COLORS = {
    background: 0x14171c,
    bed: 0x10141c,
    gridMinor: 0x232a38,
    gridMajor: 0x35405a,
    bedBorder: 0x4da3ff,
    origin: 0x45c078,
    cursor: 0xe05b5b,
    docDefault: 0xd7dce4,
    docSelected: 0x4da3ff,
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

function drawDocuments(container, documents) {
    container.removeChildren().forEach(c => c.destroy())
    for (const doc of documents) {
        if (!doc.rawPaths || !doc.transform2d || doc.visible === false) continue
        const g = new Graphics()
        const color = colorOf(doc)
        for (const raw of doc.rawPaths) {
            const p = transformPath(raw, doc.transform2d)
            if (p.length < 4) continue
            g.moveTo(p[0], p[1])
            for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1])
            g.stroke({ width: 1, color, pixelLine: true })
        }
        container.addChild(g)
    }
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
    const machineWidth = useSelector(s => Number(s.settings.machineWidth) || 300)
    const machineHeight = useSelector(s => Number(s.settings.machineHeight) || 200)

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
                const cursorG = new Graphics()
                drawCursor(cursorG)
                world.addChild(gridG, docsC, cursorG)

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

                pixiRef.current = { app, viewport, world, gridG, docsC, cursorG }
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

    // documents re-render on any document change
    useEffect(() => {
        const p = pixiRef.current
        if (!p) return
        drawDocuments(p.docsC, documents)
    }, [ready, documents])

    return (
        <div ref={holderRef} style={{ ...style, overflow: 'hidden' }}
            title="Workspace 2.0 (PixiJS prototype) — drag to pan, wheel to zoom" />
    )
}

export default Workspace2
