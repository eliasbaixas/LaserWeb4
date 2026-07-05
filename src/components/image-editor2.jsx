/**
 * Image editor 2 — the Claude Design replacement for the legacy Filters/Trace
 * modal (image-filters.jsx). Function component + hooks, rendered in a portal.
 *
 * Wiring: the Adjust tab edits the SAME filter fields the raster operation
 * carries (OPERATION_GROUPS.Filters), live through setOperationAttrs — the
 * preview here and the gcode generator share canvasFilters, so what you see
 * is what burns. The Trace tab runs potrace on the filtered canvas and can
 * add the result to the workspace as a new SVG document.
 * @module
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import { connect } from 'react-redux'

import { canvasFilters } from '../lib/lw.raster2gcode/canvas-filters'
import Potrace from '../lib/potrace/potrace'
import Parser from '../lib/lw.svg-parser/parser'
import { promisedImage, imageTagPromise } from '../lib/image-utils'
import { loadDocument } from '../actions/document'
import { setOperationAttrs } from '../actions/operation'
import { sendAsFile } from '../lib/helpers'
import { t } from '../lib/i18n'

const FILTER_FIELDS = ['smoothing', 'brightness', 'contrast', 'gamma', 'grayscale', 'shadesOfGray', 'invertColor', 'dithering']

const FILTER_DEFAULTS = {
    smoothing: false, brightness: 0, contrast: 0, gamma: 0,
    grayscale: 'none', shadesOfGray: 256, invertColor: false, dithering: false,
}

const TRACE_DEFAULTS = {
    turnpolicy: 'minority', turdsize: 2, alphamax: 1, optcurve: true, opttolerance: 0.2,
}

const GRAYSCALE_OPTIONS = [
    ['none', 'None (keep color)'],
    ['average', 'Average'],
    ['luma', 'Luma'],
    ['luma-601', 'Luma 601'],
    ['luma-709', 'Luma 709 · recommended'],
    ['luma-240', 'Luma 240'],
    ['desaturation', 'Desaturation'],
    ['decomposition-min', 'Decomposition · min'],
    ['decomposition-max', 'Decomposition · max'],
    ['red-chanel', 'Red channel'],
    ['green-chanel', 'Green channel'],
    ['blue-chanel', 'Blue channel'],
]

const TURN_POLICIES = ['minority', 'majority', 'black', 'white', 'right', 'left', 'random']

const VIOLET = '#a13bc4' // --fp-violet, as a literal (CSS vars don't reach blob <img>s)

const pick = (obj, keys) => Object.fromEntries(keys.map(k => [k, obj[k]]))

/* ---- small building blocks (design2.css classes) ---------------------- */

function Toggle({ on, onChange, violet }) {
    return (
        <span className={'d2-toggle' + (on ? ' on' : '') + (violet ? ' violet' : '')}
            role="switch" aria-checked={!!on} onClick={() => onChange(!on)}>
            <span className="d2-knob" />
        </span>
    )
}

function ToggleRow({ title, hint, on, onChange, violet, extra }) {
    return (
        <div className="d2-row">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1 }}>
                    <div className="d2-row-title">{title} {extra}</div>
                    <div className="d2-microcopy" style={{ margin: '2px 0 0' }}>{hint}</div>
                </div>
                <Toggle on={on} onChange={onChange} violet={violet} />
            </div>
        </div>
    )
}

// Numeric twin of a slider: keeps a local draft so partial input ("-", "0.")
// doesn't fight the controlled value.
function NumInput({ value, onCommit }) {
    const [text, setText] = useState(String(value))
    useEffect(() => { setText(String(value)) }, [value])
    return <input className="d2-num" value={text} onChange={e => {
        setText(e.target.value)
        const v = +e.target.value
        if (e.target.value.trim() !== '' && isFinite(v)) onCommit(v)
    }} />
}

function SliderRow({ title, hint, value, onChange, min, max, step, units }) {
    const clamp = v => Math.max(min, Math.min(max, v))
    return (
        <div className="d2-row">
            <div className="d2-row-head">
                <span className="d2-row-title">{title}</span>
                <span className="d2-spacer" />
                <NumInput value={value} onCommit={v => onChange(clamp(v))} />
                <span className="d2-units">{units || `${min}…${max}`}</span>
            </div>
            <div className="d2-microcopy">{hint}</div>
            <input type="range" className="d2-slider" min={min} max={max} step={step || 1}
                value={value} onChange={e => onChange(+e.target.value)} />
        </div>
    )
}

function SelectRow({ title, hint, value, onChange, options }) {
    return (
        <div className="d2-row">
            <div className="d2-row-title" style={{ marginBottom: 3 }}>{title}</div>
            <div className="d2-microcopy">{hint}</div>
            <div className="d2-select-wrap">
                <select className="d2-select" value={value} onChange={e => onChange(e.target.value)}>
                    {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                </select>
            </div>
        </div>
    )
}

/* ---- the editor -------------------------------------------------------- */

function ImageEditor2({ show, onHide, initialTab, documents, operations, currentOperation, dispatch }) {
    const [tab, setTab] = useState('adjust')
    const [view, setView] = useState('result')
    const [zoom, setZoom] = useState(100)
    const [localFilters, setLocalFilters] = useState(FILTER_DEFAULTS)
    const [traceParams, setTraceParams] = useState(TRACE_DEFAULTS)
    const [trace, setTrace] = useState({ svg: null, previewUrl: null, working: false, visible: false })

    const canvasRef = useRef(null)
    const snapRef = useRef(null)

    const doc = useMemo(() => documents.find(d => d.selected && d.dataURL), [documents])

    const op = useMemo(() => {
        if (!doc) return null
        const isRasterOf = o => o.type && /Raster/i.test(o.type) && o.documents && o.documents.includes(doc.id)
        return operations.find(o => o.id === currentOperation && isRasterOf(o)) || operations.find(isRasterOf) || null
    }, [operations, currentOperation, doc])

    const filters = op ? pick(op, FILTER_FIELDS) : localFilters
    const filtersKey = JSON.stringify(filters)

    const setFilters = attrs => {
        if (op) dispatch(setOperationAttrs(attrs, op.id))
        else setLocalFilters(f => ({ ...f, ...attrs }))
    }

    // Snapshot on open (for Cancel) + reset per-session bits.
    useEffect(() => {
        if (!show) return
        snapRef.current = op ? { opId: op.id, filters: pick(op, FILTER_FIELDS) } : null
        setTab(initialTab === 'trace' ? 'trace' : 'adjust'); setView('result'); setZoom(100)
        setTrace(tr => ({ ...tr, svg: null, visible: false }))
    }, [show]) // eslint-disable-line react-hooks/exhaustive-deps

    const cancel = e => {
        const snap = snapRef.current
        if (snap) dispatch(setOperationAttrs(snap.filters, snap.opId))
        onHide(e)
    }

    // Redraw the preview canvas (debounced; canvasFilters is per-pixel work).
    useEffect(() => {
        if (!show || !doc) return
        const timer = setTimeout(() => {
            promisedImage(doc.dataURL).then(image => {
                const canvas = canvasRef.current
                if (!canvas) return // closed while the image loaded
                canvas.width = image.naturalWidth
                canvas.height = image.naturalHeight
                canvas.getContext('2d').drawImage(image, 0, 0)
                if (view !== 'original') {
                    const f = { ...filters }
                    if (view === 'burn' && f.grayscale === 'none') f.grayscale = 'luma-709'
                    canvasFilters(canvas, f)
                }
            })
        }, 150)
        return () => clearTimeout(timer)
    }, [show, doc, view, filtersKey]) // eslint-disable-line react-hooks/exhaustive-deps

    // Escape = cancel.
    useEffect(() => {
        if (!show) return
        const onKey = e => { if (e.key === 'Escape') cancel(e) }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    }) // deliberately unmemoized: cancel closes over fresh state each render

    // Blob URL housekeeping.
    useEffect(() => () => { if (trace.previewUrl) window.URL.revokeObjectURL(trace.previewUrl) }, [trace.previewUrl])

    if (!show) return null

    const handleTrace = () => {
        const canvas = canvasRef.current
        if (!canvas || !doc) return
        setTrace(tr => ({ ...tr, working: true }))
        Potrace.loadImageFromUrl(canvas.toDataURL())
        Potrace.setParameter(traceParams)
        Potrace.process(() => {
            const raw = Potrace.getSVG(1)
            const [wpx, hpx] = doc.originalPixels || [canvas.width, canvas.height]
            const svg = raw.replace(/width="([^"]+)" height="([^"]+)"/i,
                () => `width="${wpx.toFixed(3)}mm" height="${hpx.toFixed(3)}mm" viewBox="0 0 ${wpx} ${hpx}" `)
            const overlay = raw.replace('stroke="none" fill="black"',
                `stroke="${VIOLET}" stroke-width="${Math.max(1, Math.round(canvas.width / 400))}" fill="none"`)
            const previewUrl = window.URL.createObjectURL(new Blob([overlay], { type: 'image/svg+xml;charset=utf-8' }))
            setTrace({ svg, previewUrl, working: false, visible: true })
        })
    }

    const handleCreateVector = () => {
        if (!trace.svg) return
        setTrace(tr => ({ ...tr, working: true }))
        const parser = new Parser({})
        parser.parse(trace.svg)
            .then(tags => imageTagPromise(tags))
            .then(tags => {
                const attrs = doc.transform2d ? { transform2d: doc.transform2d.slice() } : null
                dispatch(loadDocument({ name: `Traced ${doc.name}`, type: 'image/svg+xml' }, { parser, tags, attrs }, {}))
                setTrace(tr => ({ ...tr, working: false }))
            })
            .catch(e => { console.error(e); setTrace(tr => ({ ...tr, working: false })) })
    }

    const handleDownload = () => {
        if (trace.svg) sendAsFile(doc.name + '.svg', trace.svg, 'image/svg+xml')
    }

    const isTrace = tab === 'trace'
    const traceVisible = isTrace && trace.visible && trace.previewUrl

    const viewHints = { result: t('with your adjustments'), original: t('untouched image'), burn: t('laser power map') }
    let caption
    if (isTrace) caption = trace.svg ? t('Trace · detected outlines over the image') : t('Trace · press «Preview trace»')
    else if (view === 'burn') caption = t('Simulation: the darker, the more the laser burns')
    else if (view === 'original') caption = t('Original — compare with «Result»')
    else caption = (filters.grayscale !== 'none' || filters.dithering) ? t('Ready to engrave') : t('Freshly loaded image — adjust it for engraving')

    const stop = e => e.stopPropagation()

    const body = doc ? (
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>

            {/* preview stage */}
            <section style={{ flex: 1, minWidth: 0, position: 'relative', background: 'var(--fp-stage)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: 14, left: 14, right: 14, display: 'flex', alignItems: 'center', gap: 10, zIndex: 5 }}>
                    <div className="d2-chipbar-dark">
                        {[['result', t('Result')], ['original', t('Original')], ['burn', t('Burn')]].map(([v, label]) =>
                            <button key={v} className={'d2-chip' + (view === v ? ' on' : '')} onClick={() => setView(v)}>{label}</button>)}
                    </div>
                    <span style={{ fontSize: 11, color: 'oklch(0.85 0.01 60)', background: 'oklch(0.2 0.01 60 / 0.6)', borderRadius: 8, padding: '5px 9px' }}>{viewHints[view]}</span>
                    <div style={{ flex: 1 }} />
                    <div className="d2-chipbar-dark">
                        <button className="d2-chip" style={{ fontSize: 15 }} onClick={() => setZoom(z => Math.max(50, z - 25))}>−</button>
                        <button className="d2-chip" style={{ minWidth: 52, fontFamily: 'var(--fp-mono)' }} onClick={() => setZoom(100)}>{zoom}%</button>
                        <button className="d2-chip" style={{ fontSize: 15 }} onClick={() => setZoom(z => Math.min(300, z + 25))}>+</button>
                    </div>
                </div>

                <div style={{ position: 'relative', maxWidth: '72%', maxHeight: '78%', display: 'flex', borderRadius: 6, overflow: 'hidden', boxShadow: '0 12px 40px oklch(0 0 0 / 0.5)', transform: `scale(${zoom / 100})`, transition: 'transform .18s' }}>
                    <canvas ref={canvasRef} style={{ display: 'block', maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                    {view === 'burn' && !isTrace &&
                        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', mixBlendMode: 'multiply', background: 'linear-gradient(180deg, oklch(0.75 0.14 60), oklch(0.4 0.13 40))' }} />}
                    {traceVisible &&
                        <img src={trace.previewUrl} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', filter: 'drop-shadow(0 0 3px oklch(0.55 0.2 320 / 0.6))' }} />}
                </div>

                <div style={{ position: 'absolute', bottom: 14, left: 0, right: 0, textAlign: 'center', fontSize: 11, color: 'oklch(0.72 0.01 60)' }}>{caption}</div>
            </section>

            {/* side panel */}
            <aside style={{ width: 384, flex: '0 0 auto', background: 'var(--fp-panel)', borderLeft: '1px solid var(--fp-border-input)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>
                    {!isTrace ? (
                        <div>
                            <div className="d2-section-title">{t('Image adjustments')}</div>
                            <p className="d2-section-intro">{t('Engraving turns each pixel into laser power:')} <strong>{t('dark burns more')}</strong>. {t('Prepare the photo here so it comes out recognizable.')}</p>

                            <ToggleRow title={t('Smoothing')} hint={t('Reduces noise before processing.')}
                                on={filters.smoothing} onChange={v => setFilters({ smoothing: v })} />
                            <SliderRow title={t('Brightness')} hint={t('Raise it if the photo comes out too burnt (dark).')}
                                value={filters.brightness} onChange={v => setFilters({ brightness: v })} min={-255} max={255} units="−255…255" />
                            <SliderRow title={t('Contrast')} hint={t('Separates lights and shadows. The most important for recognizability.')}
                                value={filters.contrast} onChange={v => setFilters({ contrast: v })} min={-255} max={255} units="−255…255" />
                            <SliderRow title={t('Gamma')} hint={t('Fine-tunes midtones without touching blacks or whites. 0 = off.')}
                                value={filters.gamma} onChange={v => setFilters({ gamma: v })} min={0} max={7.99} step={0.01} units="0…7.99" />
                            <SelectRow title={t('Grayscale conversion')} hint={t('How color translates to gray levels.')}
                                value={filters.grayscale} onChange={v => setFilters({ grayscale: v })}
                                options={GRAYSCALE_OPTIONS.map(([v, label]) => [v, t(label)])} />
                            <SliderRow title={t('Gray levels')} hint={t('How many tones to use. Few = poster style; many = photo.')}
                                value={filters.shadesOfGray} onChange={v => setFilters({ shadesOfGray: v })} min={2} max={256} units="2…256" />
                            <ToggleRow title={t('Invert')} hint={t('For materials that lighten when engraved.')}
                                on={filters.invertColor} onChange={v => setFilters({ invertColor: v })} />
                            <ToggleRow title={t('Dithering')} extra={<span style={{ fontWeight: 500, color: 'var(--fp-text-muted)', fontSize: 11 }}>(Floyd–Steinberg)</span>}
                                hint={t('Simulates tones with dots. Ideal for photos.')}
                                on={filters.dithering} onChange={v => setFilters({ dithering: v })} />
                        </div>
                    ) : (
                        <div>
                            <div className="d2-section-title">{t('Trace · vectorize')}</div>
                            <p className="d2-section-intro">{t('Converts the bitmap into vector outlines (potrace), to cut silhouettes or for the pen-plotter. It is a separate output from engraving.')}</p>

                            <SelectRow title="Turn policy" hint={t('How to resolve ambiguities when tracing. «Minority» works well almost always.')}
                                value={traceParams.turnpolicy} onChange={v => setTraceParams(p => ({ ...p, turnpolicy: v }))}
                                options={TURN_POLICIES.map(v => [v, v])} />
                            <SliderRow title="Despeckle" hint={t('Ignore specks smaller than this size (turdsize).')}
                                value={traceParams.turdsize} onChange={v => setTraceParams(p => ({ ...p, turdsize: v }))} min={0} max={20} units="px" />
                            <SliderRow title="Alpha max" hint={t('How much to round corners. High = smoother curves.')}
                                value={traceParams.alphamax} onChange={v => setTraceParams(p => ({ ...p, alphamax: v }))} min={0} max={1.34} step={0.01} units="0…1.34" />
                            <ToggleRow title={t('Optimize curves')} hint={t('Joins segments into cleaner curves.')} violet
                                on={traceParams.optcurve} onChange={v => setTraceParams(p => ({ ...p, optcurve: v }))} />
                            <SliderRow title={t('Tolerance')} hint={t('Margin for curve optimization.')}
                                value={traceParams.opttolerance} onChange={v => setTraceParams(p => ({ ...p, opttolerance: v }))} min={0} max={1} step={0.01} units="0…1" />

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 16 }}>
                                <button className="d2-btn" disabled={trace.working}
                                    style={{ borderColor: 'var(--fp-violet)', color: 'var(--fp-violet)', background: 'var(--fp-violet-soft)' }}
                                    onClick={handleTrace}>◑ {trace.working ? t('Working…') : t('Preview trace')}</button>
                                {trace.visible && trace.svg &&
                                    <div className="d2-microcopy" style={{ textAlign: 'center' }}>
                                        <a style={{ cursor: 'pointer', color: 'var(--fp-violet)' }} onClick={() => setTrace(tr => ({ ...tr, visible: false }))}>{t('Hide trace')}</a>
                                    </div>}
                                <button className="d2-btn d2-btn-violet" disabled={!trace.svg || trace.working} onClick={handleCreateVector}>⌇ {t('Create vector document')}</button>
                                <button className="d2-btn" disabled={!trace.svg || trace.working} onClick={handleDownload}>{t('Download SVG')}</button>
                                <div className="d2-microcopy" style={{ textAlign: 'center' }}>
                                    {t('It is added to the workspace as')} <span style={{ fontFamily: 'var(--fp-mono)', color: 'var(--fp-text-soft)' }}>Traced {doc.name}</span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </aside>
        </div>
    ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fp-text-muted)' }}>
            {t('Select an image in the workspace to edit it.')}
        </div>
    )

    const [wpx, hpx] = (doc && doc.originalPixels) || [null, null]

    const modal = (
        <div onClick={stop} onDoubleClick={stop} onMouseDown={stop} onMouseUp={stop} onKeyDown={stop}
            style={{ position: 'fixed', inset: 0, zIndex: 10050, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(120% 120% at 50% 0%, oklch(0.32 0.01 60 / 0.92), oklch(0.22 0.01 60 / 0.92))', fontFamily: 'var(--fp-font)', color: 'var(--fp-text)', cursor: 'auto' }}>
            <div style={{ width: '95vw', height: '95vh', background: 'var(--fp-bg)', borderRadius: 18, boxShadow: '0 30px 80px oklch(0 0 0 / 0.5)', display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '1px solid oklch(0.5 0.01 60 / 0.4)', textAlign: 'left' }}>

                {/* header */}
                <header style={{ flex: '0 0 auto', height: 60, display: 'flex', alignItems: 'center', gap: 16, padding: '0 16px 0 20px', borderBottom: '1px solid var(--fp-border-input)', background: 'var(--fp-surface)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
                        {doc && <img src={doc.dataURL} alt="" style={{ width: 34, height: 34, borderRadius: 9, flex: '0 0 auto', border: '1px solid var(--fp-border-input)', objectFit: 'cover' }} />}
                        <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.1 }}>{t('Edit image')}</div>
                            {doc && <div style={{ fontSize: 11, color: 'var(--fp-text-muted)', fontFamily: 'var(--fp-mono)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {doc.name}{wpx ? ` · ${Math.round(wpx)}×${Math.round(hpx)} px` : ''}</div>}
                        </div>
                    </div>

                    <div className="d2-chipbar" style={{ marginLeft: 8 }}>
                        <button className={'d2-chip' + (!isTrace ? ' on' : '')} onClick={() => setTab('adjust')}><span style={{ fontSize: 13 }}>✦</span> {t('Adjust for engraving')}</button>
                        <button className={'d2-chip' + (isTrace ? ' on' : '')} onClick={() => setTab('trace')}><span style={{ fontSize: 13 }}>⌇</span> {t('Trace · vectorize')}</button>
                    </div>

                    <div style={{ flex: 1 }} />
                    <button className="d2-btn" style={{ fontSize: 12, padding: '8px 12px' }} onClick={() => setFilters(FILTER_DEFAULTS)}>↺ {t('Reset')}</button>
                    <button className="d2-btn" style={{ width: 36, height: 36, padding: 0, fontSize: 16 }} onClick={cancel} aria-label={t('Cancel')}>✕</button>
                </header>

                {body}

                {/* footer */}
                <footer style={{ flex: '0 0 auto', height: 64, display: 'flex', alignItems: 'center', gap: 14, padding: '0 20px', borderTop: '1px solid var(--fp-border-input)', background: 'var(--fp-surface)' }}>
                    {op ? (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--fp-text-muted)' }}>
                            <span style={{ width: 16, height: 16, borderRadius: 5, background: 'var(--fp-go-soft)', border: '1px solid var(--fp-go-line)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fp-go-deep)', fontSize: 10 }}>✓</span>
                            {t("Adjustments are saved to this document's raster operation.")}
                        </span>
                    ) : doc ? (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--fp-amber-deep)' }}>
                            <span style={{ width: 16, height: 16, borderRadius: 5, background: 'var(--fp-amber-soft)', border: '1px solid var(--fp-amber-line)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>!</span>
                            {t("No raster operation uses this image — adjustments won't persist.")}
                        </span>
                    ) : <span />}
                    <div style={{ flex: 1 }} />
                    <button className="d2-btn" onClick={cancel}>{t('Cancel')}</button>
                    <button className="d2-btn d2-btn-go" onClick={onHide}>✓ {t('Done')}</button>
                </footer>
            </div>
        </div>
    )

    return ReactDOM.createPortal(modal, document.body)
}

export default connect(state => ({
    documents: state.documents,
    operations: state.operations,
    currentOperation: state.currentOperation,
}))(ImageEditor2)
