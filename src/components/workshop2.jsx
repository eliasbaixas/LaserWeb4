/**
 * Workshop 2.0: Claude Design pipeline surface for the Files/CAM pane.
 * It keeps the existing Documents/Operations/G-code actions and renders them
 * in a step-based workflow.
 * @module
 */

import React, { useCallback, useContext, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import convert from 'color-convert'

import {
    DOCUMENT_FILETYPES, loadSVG, loadGcode, loadFiles,
} from './cam'
import { loadDocument, setDocumentAttrs, cloneDocumentSelected, selectDocument, selectDocuments, toggleSelectDocument, toggleVisibleDocument, colorDocumentSelected, removeDocument, removeDocumentSelected, selectDocumentsByColor } from '../actions/document'
import { setGcode, generatingGcode } from '../actions/gcode'
import { resetWorkspace } from '../actions/laserweb'
import { selectedDocuments, dropDocumentsOnOperation, operationTargetAt } from './document'
import { documentCacheContext } from './document-cache'
import { addOperation, clearOperations, moveOperation, operationRemoveDocument, removeOperation, setCurrentOperation, setOperationAttrs } from '../actions/operation'
import { OPERATION_TYPES } from './operation/definitions'
import { getGcode } from '../lib/cam-gcode'
import { sendAsFile, appendExt, openDataWindow, humanFileSize } from '../lib/helpers'
import { strftime } from '../lib/strftime'
import { shapeSvg } from '../lib/shapes'
import { t } from '../lib/i18n'
import { ValidateSettings } from '../reducers/settings'
import { uploadSnapshot } from '../actions/settings'
import { FileField, ColorPicker, SearchButton } from './forms'
import Icon from './font-awesome'
import { prompt, confirm } from './laserweb'
import CommandHistory from './command-history'
import MaterialDb2 from './material-database2'
import { saveOperationAsPreset } from './material-database'
import { getSubset } from 'redux-localstorage-filter'

let __workshopInterval

function StepBadge({ done, active, index }) {
    return (
        <span className={'wk2-step-badge' + (done ? ' done' : '') + (active ? ' active' : '')}>
            {done ? <i className="fa fa-check" /> : index}
        </span>
    )
}

function PipelineMap({ documents, operations, gcode, dirty }) {
    const steps = [
        ['Docs', documents.length > 0, documents.length === 0],
        ['Ops', operations.length > 0, documents.length > 0 && operations.length === 0],
        ['G-code', !!gcode && !dirty, operations.length > 0 && (!gcode || dirty)],
        ['Run', false, !!gcode && !dirty],
    ]
    return (
        <div className="wk2-map">
            {steps.map(([label, done, active], index) => (
                <React.Fragment key={label}>
                    {index > 0 && <span className={'wk2-map-arrow' + (steps[index - 1][1] ? ' done' : '')}>-&gt;</span>}
                    <span className={'wk2-map-chip' + (done ? ' done' : '') + (active ? ' active' : '')}>
                        {done && <i className="fa fa-check" />} {label}
                    </span>
                </React.Fragment>
            ))}
        </div>
    )
}

function AddShapeButtons() {
    const dispatch = useDispatch()
    const [size, setSize] = useState(20)

    const add = async (shape) => {
        const file = new File([shapeSvg(shape, size)], `${shape}-${size}mm.svg`, { type: 'image/svg+xml' })
        const result = await loadSVG(file)
        if (!result) return
        dispatch(loadDocument(file, result, {}))
        CommandHistory.write(`Added ${shape} (${size}mm) to the workspace`, CommandHistory.INFO)
    }

    return (
        <div className="wk2-shapes">
            <button title={t('Add square')} onClick={() => add('square')}><i className="fa fa-square-o" /></button>
            <button title={t('Add triangle')} onClick={() => add('triangle')}><i className="fa fa-caret-up" /></button>
            <button title={t('Add circle')} onClick={() => add('circle')}><i className="fa fa-circle-o" /></button>
            <input type="number" min="1" max="400" value={size} onChange={e => setSize(e.target.value)} />
            <span>mm</span>
        </div>
    )
}

function SnapshotActions({ appState, settings, onReset, onLoad }) {
    const keys = ['documents', 'operations', 'currentOperation', 'settings.toolFeedUnits']
    const save = e => {
        prompt('Save as', strftime(settings.workspaceFilename + '.json'), file => {
            if (file !== null) {
                sendAsFile(file, JSON.stringify(getSubset(appState, keys), null, 2), 'application/json')
            }
        }, !e.shiftKey)
    }

    return (
        <div className="wk2-snapshot">
            <FileField onChange={e => onLoad(e.target.files[0], keys)} accept="application/json, .json">
                <button className="d2-btn"><i className="fa fa-upload" /> {t('Load')}</button>
            </FileField>
            <button className="d2-btn" onClick={save}><i className="fa fa-download" /> {t('Save')}</button>
            <button className="d2-btn" onClick={onReset}><i className="fa fa-trash" /> {t('Reset')}</button>
        </div>
    )
}

function EmptyGuide() {
    return (
        <div className="wk2-guide">
            <div>
                <i className="fa fa-road" />
                <strong>{t('Start with a document')}</strong>
                <p>{t('Import an SVG, DXF or image, place it on the bed, then create operations and generate G-code.')}</p>
            </div>
            <div>
                <i className="fa fa-code-fork" />
                <strong>{t('Vector and raster share the same pipeline')}</strong>
                <p>{t('Vectors become cuts or engraves; images become raster jobs or traced vectors from the image editor.')}</p>
            </div>
        </div>
    )
}

function StepCard({ index, title, hint, done, active, children, action }) {
    return (
        <section className={'wk2-card' + (active ? ' active' : '')}>
            <header className="wk2-card-head">
                <StepBadge done={done} active={active} index={index} />
                <div>
                    <h2>{title}</h2>
                    <p>{hint}</p>
                </div>
                <div className="wk2-card-action">{action}</div>
            </header>
            <div className="wk2-card-body">{children}</div>
        </section>
    )
}

function DocumentTree({ documents, roots, selectedIds, filter, onToggleExpanded }) {
    const dispatch = useDispatch()
    const byId = new Map(documents.map(d => [d.id, d]))

    const show = doc => !filter || doc.name.toLowerCase().includes(filter.toLowerCase())
    const typeOf = doc => doc.dataURL ? 'Raster' : doc.rawPaths ? 'Vector' : doc.children.length ? 'Group' : 'File'

    const row = (doc, depth = 0) => {
        if (!show(doc) && !(doc.children || []).some(id => show(byId.get(id) || {}))) return null
        const visible = doc.visible !== false
        const selected = !!doc.selected
        return (
            <React.Fragment key={doc.id}>
                <div className={'wk2-doc-row' + (selected ? ' selected' : '')} style={{ paddingLeft: 8 + depth * 16 }}>
                    <button className="wk2-icon-btn" disabled={!doc.children.length} onClick={() => onToggleExpanded(doc)}>
                        {doc.children.length ? <Icon name={doc.expanded ? 'caret-down' : 'caret-right'} /> : null}
                    </button>
                    <DraggableDocName doc={doc} documents={documents} typeLabel={typeOf(doc)} />
                    <button className="wk2-icon-btn" title={visible ? t('Hide') : t('Show')} onClick={() => dispatch(toggleVisibleDocument(doc.id))}>
                        <Icon name={visible ? 'eye' : 'eye-slash'} />
                    </button>
                    <button className="wk2-icon-btn danger" title={t('Remove')} onClick={() => dispatch(removeDocument(doc.id))}>
                        <Icon name="trash" />
                    </button>
                </div>
                {doc.expanded && (doc.children || []).map(id => byId.get(id)).filter(Boolean).map(child => row(child, depth + 1))}
            </React.Fragment>
        )
    }

    if (!roots.length) {
        return <div className="wk2-empty">{t('No documents yet')}</div>
    }

    return <div className="wk2-doc-tree">{roots.map(doc => row(doc))}</div>
}

/**
 * Document name that can be dragged onto an operation card (or the dashed
 * "new operation" strip) — same pointer protocol as the classic pane:
 * targets carry data-operation-id, the shared checkpoint asks
 * reference-vs-clone, Alt clones silently.
 */
function DraggableDocName({ doc, documents, typeLabel }) {
    const dispatch = useDispatch()
    const [drag, setDrag] = useState(null)
    const stateRef = useRef({})

    const onPointerDown = e => {
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        const s = stateRef.current
        s.active = true
        s.x0 = e.clientX
        s.y0 = e.clientY
        s.started = false
        s.isToggle = e.ctrlKey || e.shiftKey || e.metaKey
        s.deferSelect = false
        if (doc.selected)
            s.deferSelect = true // may be the start of a multi-doc drag
        else if (s.isToggle)
            dispatch(toggleSelectDocument(doc.id))
        else
            dispatch(selectDocument(doc.id))
    }
    const onPointerMove = e => {
        const s = stateRef.current
        if (!s.active) return
        e.preventDefault()
        if (!s.started && Math.hypot(e.clientX - s.x0, e.clientY - s.y0) > 5)
            s.started = true
        if (s.started)
            setDrag({ x: e.clientX, y: e.clientY })
    }
    const onPointerUp = e => {
        const s = stateRef.current
        if (!s.active) return
        e.preventDefault()
        if (s.started) {
            const target = operationTargetAt(e.clientX, e.clientY)
            if (target)
                dropDocumentsOnOperation(dispatch, selectedDocuments(documents),
                    target.dataset.operationId, target.dataset.operationTabs, e.altKey)
        } else if (s.deferSelect) {
            if (s.isToggle) dispatch(toggleSelectDocument(doc.id))
            else dispatch(selectDocument(doc.id))
        }
        stateRef.current = {}
        setDrag(null)
    }
    const onPointerCancel = () => { stateRef.current = {}; setDrag(null) }

    return (
        <React.Fragment>
            <button className="wk2-doc-main" style={{ touchAction: 'none' }}
                onPointerDown={onPointerDown} onPointerMove={onPointerMove}
                onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}>
                <span>{doc.name}</span>
                <small>{typeLabel}</small>
            </button>
            {drag && (
                <div className="wk2-drag-ghost" style={{ left: drag.x, top: drag.y }}>
                    {documents.filter(d => d.selected).map(d => <div key={d.id}>{d.name}</div>)}
                </div>
            )}
        </React.Fragment>
    )
}

/** Material library on the op card: wand applies a preset, floppy saves one. */
function OpMaterialButtons({ op }) {
    const dispatch = useDispatch()
    const groups = useSelector(s => s.materialDatabase)
    const [showPicker, setShowPicker] = useState(false)
    return (
        <React.Fragment>
            <button title={t('Apply a material preset')} onClick={() => setShowPicker(true)}><Icon name="magic" /></button>
            <button title={t('Save these settings as a material preset')}
                onClick={() => saveOperationAsPreset(dispatch, groups, op)}><Icon name="floppy-o" /></button>
            {showPicker && (
                <MaterialDb2 mode="pick" show onHide={() => setShowPicker(false)}
                    types={Object.keys(OPERATION_TYPES)}
                    onApplyPreset={(type, attrs) => dispatch(setOperationAttrs({ ...attrs, type }, op.id))} />
            )}
        </React.Fragment>
    )
}

function ParamInput({ label, value, units, onChange }) {
    return (
        <label className="wk2-param">
            <span>{label}</span>
            <div>
                <input type="number" value={value || 0} onChange={e => onChange(+e.target.value)} />
                {units && <small>{units}</small>}
            </div>
        </label>
    )
}

function OperationList2({ documents, operations, currentOperation, settings }) {
    const dispatch = useDispatch()
    const selectedIds = selectedDocuments(documents)
    const byId = new Map(documents.map(d => [d.id, d]))
    const hasSelected = selectedIds.length > 0

    const createSingle = e => dropDocumentsOnOperation(dispatch, selectedIds, 'new', false, e.altKey)
    const createMultiple = e => dropDocumentsOnOperation(dispatch, selectedIds, 'new', false, e.altKey,
        ids => ids.forEach(id => dispatch(addOperation({ documents: [id] }))))
    const clearAll = () => confirm('Are you sure?', ok => ok && dispatch(clearOperations()))
    const selectOp = op => {
        dispatch(setCurrentOperation(op.id))
        dispatch(selectDocuments(false))
        ;(op.documents || []).forEach(id => dispatch(toggleSelectDocument(id)))
    }

    return (
        <div className="wk2-ops">
            <div className="wk2-ops-toolbar">
                <button className="d2-btn" disabled={!hasSelected && !settings.toolCreateEmptyOps}
                    onClick={createSingle}>
                    <i className="fa fa-object-group" /> {t('Create Single')}
                </button>
                <button className="d2-btn" disabled={!hasSelected} onClick={createMultiple}>
                    <i className="fa fa-object-ungroup" /> {t('Create Multiple')}
                </button>
                <button className="d2-btn" disabled={!operations.length} onClick={clearAll}>
                    <i className="fa fa-trash" /> {t('Clear All')}
                </button>
            </div>

            <div className="wk2-drop-new" data-operation-id="new">
                <i className="fa fa-hand-lizard-o" /> {t('Drag documents here to create an operation')}
            </div>

            {!operations.length ? (
                <div className="wk2-empty">{documents.length ? t('Select documents, then create an operation') : t('Add documents first')}</div>
            ) : operations.map((op, index) => {
                const selected = currentOperation === op.id
                const raster = /Raster/i.test(op.type)
                return (
                    <article key={op.id} data-operation-id={op.id}
                        className={'wk2-op-card' + (selected ? ' selected' : '') + (!op.enabled ? ' disabled' : '')}
                        onClick={() => selectOp(op)}>
                        <header>
                            <span className="wk2-op-order">#{index + 1}</span>
                            <select value={op.type} onChange={e => dispatch(setOperationAttrs({ type: e.target.value }, op.id))}
                                onClick={e => e.stopPropagation()}>
                                {Object.keys(OPERATION_TYPES).map(type => <option key={type}>{type}</option>)}
                            </select>
                            <div className="wk2-op-actions" onClick={e => e.stopPropagation()}>
                                <OpMaterialButtons op={op} />
                                <button title={op.enabled ? t('Disable') : t('Enable')} onClick={() => dispatch(setOperationAttrs({ enabled: !op.enabled }, op.id))}><Icon name="power-off" /></button>
                                <button title={t('Move up')} onClick={() => dispatch(moveOperation(op.id, -1))}><Icon name="arrow-up" /></button>
                                <button title={t('Move down')} onClick={() => dispatch(moveOperation(op.id, +1))}><Icon name="arrow-down" /></button>
                                <button title={t('Remove')} className="danger" onClick={() => dispatch(removeOperation(op.id))}><Icon name="trash" /></button>
                            </div>
                        </header>

                        <div className="wk2-op-docs" onClick={e => e.stopPropagation()}>
                            {(op.documents || []).length ? op.documents.map(id => {
                                const doc = byId.get(id)
                                if (!doc) return null
                                return (
                                    <span key={id}>
                                        {doc.name}
                                        <button title={t('Remove document from operation')} onClick={() => dispatch(operationRemoveDocument(op.id, false, id))}>x</button>
                                    </span>
                                )
                            }) : <em>{t('No documents attached')}</em>}
                        </div>

                        <div className="wk2-op-params" onClick={e => e.stopPropagation()}>
                            <ParamInput label={t('Speed')} value={op.cutRate} units={settings.toolFeedUnits}
                                onChange={v => dispatch(setOperationAttrs({ cutRate: v }, op.id))} />
                            <ParamInput label={t('Power')} value={op.laserPower} units="%"
                                onChange={v => dispatch(setOperationAttrs({ laserPower: v }, op.id))} />
                            <ParamInput label={t('Passes')} value={op.passes} units="x"
                                onChange={v => dispatch(setOperationAttrs({ passes: v }, op.id))} />
                            {raster && <ParamInput label={t('Line distance')} value={op.lineDistance} units="mm"
                                onChange={v => dispatch(setOperationAttrs({ lineDistance: v }, op.id))} />}
                        </div>
                    </article>
                )
            })}
        </div>
    )
}

export default function Workshop2() {
    const dispatch = useDispatch()
    const appState = useSelector(state => state)
    const settings = useSelector(state => state.settings)
    const documents = useSelector(state => state.documents)
    const operations = useSelector(state => state.operations)
    const currentOperation = useSelector(state => state.currentOperation)
    const gcode = useSelector(state => state.gcode.content)
    const gcoding = useSelector(state => state.gcode.gcoding)
    const dirty = useSelector(state => state.gcode.dirty)
    const documentCacheHolder = useContext(documentCacheContext)
    const generationRef = useRef()
    const [filter, setFilter] = useState()
    const [libraryOpen, setLibraryOpen] = useState(null)
    const [dropHover, setDropHover] = useState(0)

    const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files')
    const onDragOver = e => { if (hasFiles(e)) { e.preventDefault(); e.stopPropagation() } }
    const onDragEnter = e => { if (hasFiles(e)) setDropHover(h => h + 1) }
    const onDragLeave = e => { if (hasFiles(e)) setDropHover(h => Math.max(0, h - 1)) }
    const onDrop = e => {
        if (!hasFiles(e)) return
        e.preventDefault()
        e.stopPropagation()
        setDropHover(0)
        loadFiles(dispatch, e.dataTransfer.files)
    }

    const handleLoadDocument = useCallback((e, modifiers = {}) => {
        loadFiles(dispatch, e.target.files, modifiers)
    }, [dispatch])

    const loadSnapshot = useCallback((file, keys) => {
        loadGcode(file).then(content => dispatch(uploadSnapshot(file, content, keys)))
    }, [dispatch])

    const saveGcode = useCallback((e) => {
        prompt('Save as', strftime(settings.gcodeFilename), (file) => {
            if (file !== null) sendAsFile(appendExt(file, settings.gcodeExtension), gcode)
        }, !e.shiftKey)
    }, [settings, gcode])

    const viewGcode = useCallback((e) => {
        if (gcode.length < 1048576) openDataWindow(gcode)
        else confirm(`Size: ${humanFileSize(gcode.length)}, viewing very large files can negatively affect browser performance. Are you sure?`, accepted => {
            if (accepted) openDataWindow(gcode)
        }, e.shiftKey)
    }, [gcode])

    const clearGcode = useCallback((e) => {
        confirm('This will delete the currently loaded Gcode. Are you sure?', accepted => {
            if (accepted) dispatch(setGcode(''))
        }, e.shiftKey)
    }, [dispatch])

    const loadGcodeDirectly = useCallback((e) => {
        loadGcode(e.target.files[0]).then(text => dispatch(setGcode(text)))
    }, [dispatch])

    const generateGcode = useCallback((_e) => {
        let percent = 0
        __workshopInterval = setInterval(() => {
            dispatch(generatingGcode(true, isNaN(percent) ? 0 : Number(percent)))
        }, 100)
        generationRef.current = getGcode(settings, documents, operations, documentCacheHolder,
            (msg, level) => CommandHistory.write(msg, level),
            text => {
                clearInterval(__workshopInterval)
                dispatch(generatingGcode(false))
                dispatch(setGcode(text))
            },
            threads => {
                percent = ((Array.isArray(threads)) ? (threads.reduce((a, b) => a + b, 0) / threads.length) : threads).toFixed(2)
            })
    }, [dispatch, documents, operations, settings, documentCacheHolder])

    const stopGcode = useCallback(() => {
        if (generationRef.current != null) {
            generationRef.current.end()
            generationRef.current = null
        }
        clearInterval(__workshopInterval)
        dispatch(generatingGcode(false))
    }, [dispatch])

    const subtreeIds = rootId => {
        const byId = new Map(documents.map(d => [d.id, d]))
        const out = []
        const walk = id => {
            out.push(id)
            const d = byId.get(id)
            if (d && d.children) d.children.forEach(walk)
        }
        walk(rootId)
        return out
    }
    const rootOf = id => {
        const parent = documents.find(d => d.children && d.children.includes(id))
        return parent ? rootOf(parent.id) : id
    }
    const setSubtreeVisible = (rootId, visible) =>
        subtreeIds(rootId).forEach(id => dispatch(setDocumentAttrs({ visible }, id)))
    const sendSelectedToLibrary = () => {
        new Set(documents.filter(d => d.selected).map(d => rootOf(d.id)))
            .forEach(rootId => {
                dispatch(setDocumentAttrs({ library: true }, rootId))
                setSubtreeVisible(rootId, false)
            })
        dispatch(selectDocuments(false))
    }
    // membership is the explicit `library` flag on the root: the eye icon
    // only toggles visibility, it never archives
    const byId = new Map(documents.map(d => [d.id, d]))
    const libraryRoots = documents.filter(d => d.isRoot && d.library)
    const libraryIds = new Set(libraryRoots.map(d => d.id))
    const bedDocuments = documents.filter(d => !libraryIds.has(d.id))

    const validator = ValidateSettings(false)
    const valid = validator.passes()
    const someSelected = documents.some(i => i.selected)
    const selectedIds = selectedDocuments(documents)
    const docsDone = documents.length > 0
    const opsDone = operations.length > 0
    const gcodeDone = !!gcode && !dirty

    return (
        <div className={'wk2' + (dropHover ? ' wk2-dropping' : '')}
            onDragOver={onDragOver} onDragEnter={onDragEnter} onDragLeave={onDragLeave} onDrop={onDrop}>
            <div className="wk2-header">
                <div>
                    <h1>{t('Workshop')}</h1>
                    <p>{t('Documents, operations and G-code in one pipeline')}</p>
                </div>
                <SnapshotActions appState={appState} settings={settings} onLoad={loadSnapshot}
                    onReset={() => confirm('This will completely erase your workspace! Are you sure?', ok => ok && dispatch(resetWorkspace()))} />
                <PipelineMap {...{ documents, operations, gcode, dirty }} />
            </div>

            <div className="wk2-scroll">
                {!docsDone && !opsDone ? <EmptyGuide /> : null}

                <StepCard index={1} title={t('Documents')} hint={t('What you want to cut or engrave')} done={docsDone} active={!docsDone}
                    action={<FileField onChange={handleLoadDocument} accept={DOCUMENT_FILETYPES}><button className="d2-btn d2-btn-go"><i className="fa fa-folder-open" /> {t('Add Document')}</button></FileField>}>
                    <AddShapeButtons />
                    <div className="wk2-list">
                        <DocumentTree documents={bedDocuments}
                            roots={bedDocuments.filter(doc => doc.isRoot)}
                            selectedIds={selectedIds}
                            filter={filter}
                            onToggleExpanded={doc => dispatch(setDocumentAttrs({ expanded: !doc.expanded }, doc.id))} />
                    </div>
                    {libraryRoots.length ? (
                        <div className="wk2-library">
                            <div className="wk2-library-title"><i className="fa fa-archive" /> {t('Library')} <small>({libraryRoots.length})</small></div>
                            {libraryRoots.map(d => (
                                <div key={d.id} className="wk2-library-row">
                                    {(d.children && d.children.length) ?
                                        <button title={t('Pick parts of this file')} onClick={() => setLibraryOpen(libraryOpen === d.id ? null : d.id)}>
                                            <Icon name={libraryOpen === d.id ? 'caret-down' : 'caret-right'} />
                                        </button> : <span />}
                                    <strong>{d.name}</strong>
                                    <button title={t('Add the whole file to the bed')} onClick={() => { dispatch(setDocumentAttrs({ library: false }, d.id)); setSubtreeVisible(d.id, true) }}><Icon name="level-up" /></button>
                                    <button title={t('Delete from the library')} onClick={() => subtreeIds(d.id).forEach(id => dispatch(removeDocument(id)))}><Icon name="trash" /></button>
                                    {libraryOpen === d.id && (d.children || []).map(cid => {
                                        const child = byId.get(cid)
                                        if (!child) return null
                                        return <div key={cid} className="wk2-library-child">
                                            <span>{child.name}</span>
                                            <button onClick={() => { dispatch(setDocumentAttrs({ visible: true, library: false }, d.id)); setSubtreeVisible(cid, true) }}><Icon name="level-up" /></button>
                                        </div>
                                    })}
                                </div>
                            ))}
                        </div>
                    ) : null}
                    {documents.length ? (
                        <div className="wk2-toolbar">
                            <button title={t('Select all')} onClick={() => dispatch(selectDocuments(true))}><Icon name="cubes" /></button>
                            <button title={t('Select none')} onClick={() => dispatch(selectDocuments(false))}><Icon name="cube" /></button>
                            <button title={t('Select by color')} disabled={!someSelected} onClick={e => dispatch(selectDocumentsByColor(e.shiftKey))}><Icon name="eyedropper" /></button>
                            <button title={t('Clone selected')} disabled={!someSelected} onClick={() => dispatch(cloneDocumentSelected())}><Icon name="copy" /></button>
                            <button title={t('Create operation from selection')} disabled={!selectedIds.length} onClick={() => dispatch(addOperation({ documents: selectedIds }))}><Icon name="magic" /></button>
                            <button title={t('Send selected to library')} disabled={!someSelected} onClick={sendSelectedToLibrary}><Icon name="archive" /></button>
                            <button title={t('Remove selected')} disabled={!someSelected} onClick={() => dispatch(removeDocumentSelected())}><Icon name="trash" /></button>
                            <SearchButton bsStyle="primary" bsSize="xsmall" search={filter} onSearch={setFilter} placement="bottom"><Icon name="search" /></SearchButton>
                            <ColorPicker to="rgba" icon="pencil" bsSize="xsmall" disabled={!someSelected} onClick={v => dispatch(colorDocumentSelected({ strokeColor: v || [0, 0, 0, 1], strokeColorHex: convert.rgb.hex(v.slice(0, 3).map(x => x * 255)) || '000000' }))} />
                            <ColorPicker to="rgba" icon="paint-brush" bsSize="xsmall" disabled={!someSelected} onClick={v => dispatch(colorDocumentSelected({ fillColor: v || [0, 0, 0, 0], fillColorHex: convert.rgb.hex(v.slice(0, 3).map(x => x * 255)) || '000000' }))} />
                        </div>
                    ) : null}
                </StepCard>

                <StepCard index={2} title={t('Operations')} hint={t('The recipe for each document')} done={opsDone} active={docsDone && !opsDone}>
                    <OperationList2 {...{ documents, operations, currentOperation, settings }} />
                </StepCard>

                <StepCard index={3} title={t('G-code')} hint={dirty ? t('Workspace changed after generation') : t('Generate, inspect or export the machine program')} done={gcodeDone} active={opsDone && !gcodeDone}>
                    {gcoding.enable ? (
                        <div className="wk2-progress">
                            <div><span style={{ width: `${gcoding.percent}%` }} /></div>
                            <strong>{gcoding.percent}%</strong>
                            <button className="d2-btn d2-btn-danger" onClick={stopGcode}><Icon name="hand-paper-o" /></button>
                        </div>
                    ) : (
                        <div className="wk2-gcode-actions">
                            <button className={'d2-btn ' + (dirty ? '' : 'd2-btn-go')} disabled={!valid || gcoding.enable} onClick={generateGcode}>
                                <i className="fa fa-industry" /> {dirty ? t('Regenerate') : t('Generate')}
                            </button>
                            <button className="d2-btn" disabled={!gcode || !valid || gcoding.enable} onClick={viewGcode}><i className="fa fa-eye" /></button>
                            <button className="d2-btn" disabled={!gcode || !valid || gcoding.enable} onClick={saveGcode}><i className="fa fa-floppy-o" /></button>
                            <FileField onChange={loadGcodeDirectly} disabled={!valid || gcoding.enable} accept=".gcode,.gc,.nc">
                                <button className="d2-btn" disabled={!valid || gcoding.enable}><i className="fa fa-folder-open" /></button>
                            </FileField>
                            <button className="d2-btn" disabled={!gcode || gcoding.enable} onClick={clearGcode}><i className="fa fa-trash" /></button>
                        </div>
                    )}
                    <div className="wk2-gcode-meta">
                        {gcode ? `${gcode.split(/\r\n|\r|\n/).length} ${t('lines')}${dirty ? t(' (stale)') : ''}` : t('No G-code')}
                    </div>
                </StepCard>
            </div>
        </div>
    )
}
