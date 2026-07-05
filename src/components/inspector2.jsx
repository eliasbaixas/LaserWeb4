/**
 * Inspector 2.0 — docked right panel of canvas 2.0 (replaces the legacy
 * floating controls). Edits the selection's position / size / rotation by
 * dispatching the same transform2dSelectedDocuments matrices the canvas
 * gestures use; raster documents get a docked slice of the image filters
 * (written live to the raster operation) plus shortcuts into the full
 * image editor.
 * @module
 */

import React, { useEffect, useState } from 'react'
import { useSelector, useDispatch } from 'react-redux'

import { transform2dSelectedDocuments, removeDocumentSelected } from '../actions/document'
import { setOperationAttrs } from '../actions/operation'
import {
    docBounds, combinedBounds, computeAttachedIds,
    translateM, scaleAbout, rotateAbout, rotationDeg,
} from '../lib/doc-bounds'
import ImageEditor2 from './image-editor2'
import { t } from '../lib/i18n'

// Numeric input that keeps a local draft and commits on Enter / blur, so a
// half-typed number never dispatches a transform.
function CommitInput({ value, onCommit, width = '100%' }) {
    const [text, setText] = useState(String(value))
    useEffect(() => { setText(String(value)) }, [value])
    const commit = () => {
        const v = +text
        if (isFinite(v) && text.trim() !== '' && v !== +value) onCommit(v)
        else setText(String(value))
    }
    return <input value={text} onChange={e => setText(e.target.value)}
        onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') { commit(); e.target.blur() } }}
        style={{ width, minWidth: 0, background: 'var(--fp-surface)', border: '1px solid var(--fp-border-input)', borderRadius: 8, padding: '6px 8px', fontFamily: 'var(--fp-mono)', fontSize: 12, color: 'var(--fp-text)', outline: 'none' }} />
}

function Section({ title, sub, children }) {
    return (
        <div style={{ padding: '13px 0', borderBottom: '1px solid var(--fp-border)' }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--fp-text-soft)', letterSpacing: '0.04em', marginBottom: 9 }}>
                {title} {sub && <span style={{ color: 'var(--fp-text-muted)', fontWeight: 500 }}>{sub}</span>}
            </div>
            {children}
        </div>
    )
}

const FILTER_FIELDS = ['smoothing', 'brightness', 'contrast', 'gamma', 'grayscale', 'shadesOfGray', 'invertColor', 'dithering']

export default function Inspector2() {
    const dispatch = useDispatch()
    const documents = useSelector(s => s.documents)
    const operations = useSelector(s => s.operations)
    const currentOperation = useSelector(s => s.currentOperation)
    const machineWidth = useSelector(s => Number(s.settings.machineWidth) || 300)
    const machineHeight = useSelector(s => Number(s.settings.machineHeight) || 200)

    const [aspect, setAspect] = useState(true)
    const [editor, setEditor] = useState(null) // null | 'adjust' | 'trace'

    const selected = documents.filter(d => d.selected)
    const single = selected.length === 1 ? selected[0] : null
    const bounds = combinedBounds(selected)
    const isRaster = !!(single && single.dataURL)

    const opsUsing = single
        ? operations.filter(op => computeAttachedIds(documents, [op]).has(single.id)).length
        : null

    // raster op for the docked image controls (same pick as the image editor)
    const rasterOp = isRaster
        ? (operations.find(o => o.id === currentOperation && /Raster/i.test(o.type || '') && (o.documents || []).includes(single.id))
            || operations.find(o => /Raster/i.test(o.type || '') && (o.documents || []).includes(single.id))
            || null)
        : null

    const panel = { width: 264, flex: '0 0 auto', background: 'var(--fp-panel)', borderLeft: '1px solid var(--fp-border)', display: 'flex', flexDirection: 'column', minHeight: 0, fontSize: 13, color: 'var(--fp-text)' }

    if (!selected.length || !bounds) {
        return (
            <aside style={panel}>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '32px 24px', gap: 13 }}>
                    <div style={{ width: 52, height: 52, borderRadius: 15, background: 'var(--fp-surface)', border: '1.5px dashed var(--fp-border-input)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, color: 'var(--fp-text-muted)' }}>▦</div>
                    <div>
                        <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 5 }}>{t('Nothing selected')}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--fp-text-muted)', lineHeight: 1.5 }}>
                            {t('Click a piece on the bed to edit its position, size and rotation. Rasters add image and trace tools.')}
                        </div>
                    </div>
                </div>
            </aside>
        )
    }

    const W = bounds.x2 - bounds.x1, H = bounds.y2 - bounds.y1
    const cx = (bounds.x1 + bounds.x2) / 2, cy = (bounds.y1 + bounds.y2) / 2
    const deg = single && single.transform2d ? rotationDeg(single.transform2d) : null

    const orphan = single && opsUsing === 0
    const statusText = single
        ? (orphan ? t(' — not in any operation: it will NOT cut').replace(/^ — /, '') : `${t('in operations')}: ${opsUsing}`)
        : `${selected.length} ${t('objects')}`

    const rotate = (rad) => dispatch(transform2dSelectedDocuments(rotateAbout(rad, cx, cy)))
    const setDeg = (target) => { if (deg !== null) rotate((target - deg) * Math.PI / 180) }

    const align = (h, v) => {
        const dx = h === null ? 0
            : (h === 0 ? -bounds.x1 : (h === 1 ? (machineWidth - W) / 2 - bounds.x1 : machineWidth - W - bounds.x1))
        const dy = v === null ? 0
            : (v === 0 ? -bounds.y1 : (v === 1 ? (machineHeight - H) / 2 - bounds.y1 : machineHeight - H - bounds.y1))
        dispatch(transform2dSelectedDocuments(translateM(dx, dy)))
    }

    const iconBtn = (extra) => ({ width: 32, height: 32, border: '1px solid var(--fp-border-input)', borderRadius: 8, background: 'var(--fp-surface)', color: 'var(--fp-text)', cursor: 'pointer', fontSize: 14, ...extra })
    const rowLabel = { fontSize: 11, color: 'var(--fp-text-muted)', fontFamily: 'var(--fp-mono)' }

    const setFilter = (attrs) => { if (rasterOp) dispatch(setOperationAttrs(attrs, rasterOp.id)) }

    const miniSlider = (label, field, min, max) => (
        <div key={field}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                <span style={{ color: 'var(--fp-text-soft)', fontWeight: 500 }}>{label}</span>
                <span style={{ fontFamily: 'var(--fp-mono)', color: 'var(--fp-text-muted)' }}>{rasterOp[field]}</span>
            </div>
            <input type="range" min={min} max={max} value={rasterOp[field]}
                onChange={e => setFilter({ [field]: +e.target.value })}
                style={{ width: '100%', accentColor: 'var(--fp-accent)', height: 3, margin: 0, cursor: 'pointer' }} />
        </div>
    )

    return (
        <aside style={panel}>
            {/* header */}
            <div style={{ flex: '0 0 auto', padding: '12px 14px', borderBottom: '1px solid var(--fp-border)', display: 'flex', alignItems: 'center', gap: 10 }}>
                {isRaster
                    ? <img src={single.dataURL} alt="" style={{ width: 38, height: 38, borderRadius: 9, flex: '0 0 auto', border: '1px solid var(--fp-border-input)', objectFit: 'cover' }} />
                    : <div style={{ width: 38, height: 38, borderRadius: 9, flex: '0 0 auto', border: '1px solid var(--fp-border-input)', background: 'var(--fp-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fp-text-muted)', fontSize: 16 }}>{single ? '◇' : '⧉'}</div>}
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {single ? (single.name || t('object')) : `${selected.length} ${t('objects')}`}
                    </div>
                    <div style={{ fontSize: 10.5, fontWeight: 600, marginTop: 2, color: orphan ? 'var(--fp-amber-deep)' : 'var(--fp-go-deep)' }}>
                        {orphan ? `⚠ ${statusText}` : statusText}
                    </div>
                </div>
                {single && <span style={{ fontSize: 9, fontWeight: 700, flex: '0 0 auto', borderRadius: 6, padding: '3px 6px', color: isRaster ? 'var(--fp-amber-deep)' : 'var(--fp-accent)', background: isRaster ? 'var(--fp-amber-soft)' : 'var(--fp-info-soft)', border: `1px solid ${isRaster ? 'var(--fp-amber-line)' : 'var(--fp-info-line)'}` }}>{isRaster ? 'RASTER' : 'VECTOR'}</span>}
                <button title={t('Delete (⌫)')} onClick={() => dispatch(removeDocumentSelected())}
                    style={iconBtn({ width: 28, height: 28, color: 'var(--fp-danger)', fontSize: 12 })}>🗑</button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '0 14px 16px' }}>

                <Section title={t('POSITION')} sub={`· ${t('mm from 0,0')}`}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                                <span style={{ ...rowLabel, width: 10 }}>X</span>
                                <CommitInput value={bounds.x1.toFixed(2)} onCommit={v => dispatch(transform2dSelectedDocuments(translateM(v - bounds.x1, 0)))} />
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                                <span style={{ ...rowLabel, width: 10 }}>Y</span>
                                <CommitInput value={bounds.y1.toFixed(2)} onCommit={v => dispatch(transform2dSelectedDocuments(translateM(0, v - bounds.y1)))} />
                            </label>
                        </div>
                        <div style={{ flex: '0 0 auto' }}>
                            <div style={{ fontSize: 9, color: 'var(--fp-text-muted)', textAlign: 'center', marginBottom: 3 }}>{t('align')}</div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 16px)', gridTemplateRows: 'repeat(3, 16px)', gap: 2, padding: 4, background: 'var(--fp-surface)', border: '1px solid var(--fp-border-input)', borderRadius: 8 }}>
                                {[2, 1, 0].map(v => [0, 1, 2].map(h => (
                                    <button key={`${h}${v}`} title={t('Align on the bed')} onClick={() => align(h, v)}
                                        style={{ border: `1px solid ${h === 1 && v === 1 ? 'var(--fp-go-line)' : 'var(--fp-border-input)'}`, borderRadius: 4, background: h === 1 && v === 1 ? 'var(--fp-go-soft)' : 'var(--fp-panel2)', cursor: 'pointer', padding: 0 }} />
                                )))}
                            </div>
                        </div>
                    </div>
                </Section>

                <Section title={t('SIZE')} sub="· mm">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <label style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={rowLabel}>W</span>
                            <CommitInput value={W.toFixed(2)} onCommit={v => {
                                if (v > 0 && W > 0) { const s = v / W; dispatch(transform2dSelectedDocuments(scaleAbout(s, aspect ? s : 1, bounds.x1, bounds.y1))) }
                            }} />
                        </label>
                        <button title={t('Lock proportions')} onClick={() => setAspect(a => !a)}
                            style={{ width: 26, height: 32, flex: '0 0 auto', border: `1px solid ${aspect ? 'var(--fp-go)' : 'var(--fp-border-input)'}`, borderRadius: 8, background: aspect ? 'var(--fp-go-soft)' : 'var(--fp-surface)', color: aspect ? 'var(--fp-go-deep)' : 'var(--fp-text-muted)', cursor: 'pointer', fontSize: 11 }}>{aspect ? '🔒' : '🔓'}</button>
                        <label style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={rowLabel}>H</span>
                            <CommitInput value={H.toFixed(2)} onCommit={v => {
                                if (v > 0 && H > 0) { const s = v / H; dispatch(transform2dSelectedDocuments(scaleAbout(aspect ? s : 1, s, bounds.x1, bounds.y1))) }
                            }} />
                        </label>
                    </div>
                </Section>

                <Section title={t('ROTATION')}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <button title="-15°" onClick={() => rotate(-Math.PI / 12)} style={iconBtn()}>⟲</button>
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'center', background: 'var(--fp-surface)', border: '1px solid var(--fp-border-input)', borderRadius: 8, padding: '2px 8px' }}>
                            {deg !== null
                                ? <CommitInput width={44} value={deg.toFixed(1)} onCommit={setDeg} />
                                : <span style={{ ...rowLabel, padding: '6px 0' }}>—</span>}
                            <span style={{ fontSize: 11, color: 'var(--fp-text-muted)' }}>°</span>
                        </div>
                        <button title="+15°" onClick={() => rotate(Math.PI / 12)} style={iconBtn()}>⟳</button>
                    </div>
                    {deg !== null && (
                        <div style={{ display: 'flex', gap: 4, marginTop: 7 }}>
                            {[0, 90, 180, 270].map(v => (
                                <button key={v} onClick={() => setDeg(v)}
                                    style={{ flex: 1, fontSize: 10.5, padding: '4px 0', border: '1px solid var(--fp-border-input)', borderRadius: 7, background: Math.round(deg) % 360 === v ? 'var(--fp-go-soft)' : 'var(--fp-surface)', color: Math.round(deg) % 360 === v ? 'var(--fp-go-deep)' : 'var(--fp-text-muted)', cursor: 'pointer', fontFamily: 'var(--fp-mono)' }}>{v}°</button>
                            ))}
                        </div>
                    )}
                </Section>

                {isRaster && (
                    <Section title={t('IMAGE')} sub={rasterOp ? null : `· ${t('no raster operation yet')}`}>
                        {rasterOp ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                {miniSlider(t('Brightness'), 'brightness', -255, 255)}
                                {miniSlider(t('Contrast'), 'contrast', -255, 255)}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                                    <span className={'d2-toggle' + (rasterOp.dithering ? ' on' : '')} onClick={() => setFilter({ dithering: !rasterOp.dithering })}>
                                        <span className="d2-knob" />
                                    </span>
                                    <span style={{ fontSize: 11.5 }}>{t('Dithering')} <span style={{ color: 'var(--fp-text-muted)', fontSize: 10.5 }}>(Floyd–Steinberg)</span></span>
                                </div>
                            </div>
                        ) : (
                            <div style={{ fontSize: 11, color: 'var(--fp-text-muted)', lineHeight: 1.45, marginBottom: 4 }}>
                                {t('Add the image to a Laser Raster operation to adjust it for engraving.')}
                            </div>
                        )}
                        <button className="d2-btn" style={{ width: '100%', marginTop: 11, padding: 9, fontSize: 12 }} onClick={() => setEditor('adjust')}>
                            ✦ {t('Open image editor')}</button>
                        <button className="d2-btn" style={{ width: '100%', marginTop: 7, padding: 9, fontSize: 12, borderColor: 'var(--fp-info-line)', background: 'var(--fp-info-soft)', color: 'var(--fp-accent)' }} onClick={() => setEditor('trace')}>
                            ⌇ {t('Vectorize image')}</button>
                    </Section>
                )}

                {deg !== null && Math.abs(((deg % 360) + 360) % 360) > 0.05 && (
                    <div style={{ paddingTop: 13 }}>
                        <button className="d2-btn" style={{ width: '100%', padding: 8, fontSize: 11.5 }} onClick={() => setDeg(0)}>
                            ↺ {t('Reset rotation')}</button>
                    </div>
                )}
            </div>

            {isRaster && <ImageEditor2 show={!!editor} initialTab={editor || 'adjust'} onHide={() => setEditor(null)} />}
        </aside>
    )
}
