/**
 * Minimal SVG generators for basic shapes, with physical (mm) sizing so
 * the parser places them at true scale on the workspace.
 * @module
 */

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
