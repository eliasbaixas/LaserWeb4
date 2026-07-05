// Workspace-mm bounds of a document (rawPaths or raster corners run through
// its transform2d). Memoized per document object — documents are immutable
// in redux, so a WeakMap entry stays valid until the doc is replaced.

const cache = new WeakMap()

function corners(t, w, h) {
    const pts = [[0, 0], [w, 0], [0, h], [w, h]]
        .map(([x, y]) => [t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]])
    return {
        x1: Math.min(...pts.map(p => p[0])), x2: Math.max(...pts.map(p => p[0])),
        y1: Math.min(...pts.map(p => p[1])), y2: Math.max(...pts.map(p => p[1])),
    }
}

export function docBounds(doc) {
    if (!doc || !doc.transform2d) return null
    if (cache.has(doc)) return cache.get(doc)
    let b = null
    const t = doc.transform2d
    if (doc.dataURL && doc.originalPixels) {
        b = corners(t, doc.originalPixels[0], doc.originalPixels[1])
    } else if (doc.rawPaths) {
        let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
        for (const raw of doc.rawPaths) {
            for (let i = 0; i < raw.length; i += 2) {
                const x = t[0] * raw[i] + t[2] * raw[i + 1] + t[4]
                const y = t[1] * raw[i] + t[3] * raw[i + 1] + t[5]
                if (x < x1) x1 = x
                if (x > x2) x2 = x
                if (y < y1) y1 = y
                if (y > y2) y2 = y
            }
        }
        if (x1 < x2) b = { x1, y1, x2, y2 }
    }
    cache.set(doc, b)
    return b
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

export function combinedBounds(docs) {
    let out = null
    for (const d of docs) {
        const b = docBounds(d)
        if (!b) continue
        if (!out) out = { ...b }
        else {
            out.x1 = Math.min(out.x1, b.x1)
            out.y1 = Math.min(out.y1, b.y1)
            out.x2 = Math.max(out.x2, b.x2)
            out.y2 = Math.max(out.y2, b.y2)
        }
    }
    return out
}

// Gesture matrices (mat2d layout [a, b, c, d, e, f], same as transform2d)

export function translateM(dx, dy) {
    return [1, 0, 0, 1, dx, dy]
}

export function scaleAbout(sx, sy, ax, ay) {
    return [sx, 0, 0, sy, ax - sx * ax, ay - sy * ay]
}

export function rotateAbout(rad, ax, ay) {
    const c = Math.cos(rad), s = Math.sin(rad)
    return [c, s, -s, c, ax - c * ax + s * ay, ay - s * ax - c * ay]
}

// Current rotation of a transform2d, in degrees [0, 360)
export function rotationDeg(t) {
    const deg = Math.atan2(t[1], t[0]) * 180 / Math.PI
    return ((deg % 360) + 360) % 360
}
