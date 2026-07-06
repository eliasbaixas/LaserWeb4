/**
 * Material library 2.0: one Claude Design surface for browsing, editing and
 * applying material presets. Replaces the legacy three-pane modal
 * (material-database.jsx) and its separate picker; same redux
 * actions/data underneath, so both UIs stay interchangeable.
 *
 * mode='manage'  full CRUD (groups, presets, template, import/export)
 * mode='pick'    choose a preset and apply it to an operation
 * @module
 */

import React, { useState } from 'react'
import ReactDOM from 'react-dom'
import { useDispatch, useSelector } from 'react-redux'
import omit from 'object.omit'
import stringify from 'json-stringify-pretty-compact'

import {
    addGroup, setGroupAttrs, deleteGroup,
    addPreset, deletePreset, setPresetAttrs,
    uploadMaterialDatabase, downloadMaterialDatabase,
} from '../actions/material-database.js'
import { OPERATION_FIELDS, OPERATION_TYPES } from './operation'
import { FileStorage } from '../lib/storages'
import { materialTreeToTabular, arr2csv } from '../lib/material-database'
import { cast } from '../lib/helpers'
import { confirm } from './laserweb'
import { FileField } from './forms'
import Icon from './font-awesome'
import { t } from '../lib/i18n'

const OMIT_PARAM_FIELDS = ['name', 'filterFillColor', 'filterStrokeColor']
const REMOVE_PRESET_KEYS = new Set(['id', 'documents'])

const matchesProfile = (preset, filter) =>
    filter == null || filter === '*' || preset.machine_profile == null ||
    filter.split(',').includes(preset.machine_profile)

export function presetToOperationAttrs(preset) {
    return omit(preset.params, (value, key) => value != null && !REMOVE_PRESET_KEYS.has(key))
}

function keyStats(preset) {
    const raster = /Raster/i.test(preset.type)
    const p = preset.params || {}
    return [
        [t('Speed'), p.cutRate, 'mm/min'],
        [raster ? t('Power max') : t('Power'), raster ? p.laserPowerMax : p.laserPower, '%'],
        [t('Passes'), p.passes, 'x'],
    ]
}

function ProfileFilter({ value, onChange }) {
    const profiles = useSelector(s => s.machineProfiles)
    return (
        <select className="mdb2-select" value={value || '*'} onChange={e => onChange(e.target.value)}
            title={t('Only show presets saved for a machine profile')}>
            <option value="*">{t('All machines')}</option>
            {Object.entries(profiles).map(([key, item]) =>
                <option key={key} value={key}>{item.machineLabel}</option>)}
        </select>
    )
}

function ParamRows({ preset, editable, onChangeParam }) {
    const settings = useSelector(s => s.settings)
    const def = OPERATION_TYPES[preset.type]
    if (!def) return <div className="mdb2-empty">{t('Unknown operation type')}: {preset.type}</div>
    return (
        <div className="mdb2-params">
            {def.fields.filter(f => !OMIT_PARAM_FIELDS.includes(f)).map(key => {
                const fd = OPERATION_FIELDS[key]
                const Input = fd.input
                let error
                if (fd.check && !fd.check(preset.params[fd.name], settings, preset) && (!fd.condition || fd.condition(preset, settings)))
                    error = (typeof fd.error === 'function') ? fd.error(preset.params[fd.name], settings, preset) : fd.error
                return (
                    <label key={key} className={'mdb2-param' + (error ? ' error' : '')} title={error}>
                        <span>{fd.label}{fd.units ? <em> {fd.units}</em> : null}</span>
                        {editable
                            ? <Input op={preset.params} field={fd} style={{}}
                                onChangeValue={v => onChangeParam(fd.name, v)} />
                            : <strong>{cast(preset.params[fd.name], '—')}</strong>}
                    </label>
                )
            })}
        </div>
    )
}

function PresetCard({ preset, mode, locked, disabled, onApply }) {
    const dispatch = useDispatch()
    const [open, setOpen] = useState(false)
    const editable = mode === 'manage' && !locked
    const change = attrs => dispatch(setPresetAttrs(preset.id, attrs))

    return (
        <article className={'mdb2-card' + (disabled ? ' disabled' : '')}>
            <header>
                {editable
                    ? <input className="mdb2-name" value={preset.name} onChange={e => change({ name: e.target.value })} />
                    : <strong className="mdb2-name">{preset.name}</strong>}
                {editable
                    ? <select className="mdb2-select" value={preset.type} onChange={e => change({ type: e.target.value })}>
                        {Object.keys(OPERATION_TYPES).map(type => <option key={type}>{type}</option>)}
                    </select>
                    : <span className="mdb2-chip">{preset.type}</span>}
                <div className="mdb2-card-actions">
                    {mode === 'pick' && (
                        <button className="d2-btn d2-btn-go" disabled={disabled}
                            title={disabled ? t('Not compatible with the documents of this operation') : t('Apply this preset to the operation')}
                            onClick={() => onApply(preset)}>
                            <Icon name="magic" /> {t('Apply')}
                        </button>
                    )}
                    <button className="d2-btn" title={open ? t('Hide parameters') : t('All parameters')}
                        onClick={() => setOpen(!open)}>
                        <Icon name={open ? 'chevron-up' : 'chevron-down'} />
                    </button>
                    {editable && (
                        <button className="d2-btn d2-btn-danger" title={t('Delete preset')}
                            onClick={() => confirm(t('Delete this preset?'), ok => ok && dispatch(deletePreset(preset.id)))}>
                            <Icon name="trash" />
                        </button>
                    )}
                </div>
            </header>
            {editable
                ? <input className="mdb2-notes" placeholder={t('Notes (what material, which laser...)')}
                    value={preset.notes || ''} onChange={e => change({ notes: e.target.value })} />
                : (preset.notes ? <p className="mdb2-notes">{preset.notes}</p> : null)}
            <div className="mdb2-stats">
                {keyStats(preset).map(([label, value, units]) => (
                    <div key={label}><small>{label}</small><strong>{cast(value, '—')}</strong><em>{units}</em></div>
                ))}
                {preset.machine_profile ? <div><small>{t('Machine')}</small><strong>{preset.machine_profile}</strong></div> : null}
            </div>
            {open && <ParamRows preset={preset} editable={editable}
                onChangeParam={(name, v) => change({ params: { [name]: v } })} />}
        </article>
    )
}

function GroupTemplate({ group }) {
    const dispatch = useDispatch()
    const [open, setOpen] = useState(false)
    const change = attrs => dispatch(setGroupAttrs(group.id, attrs))
    const template = group.template || {}
    return (
        <div className="mdb2-template">
            <button className="d2-btn" onClick={() => setOpen(!open)}>
                <Icon name={open ? 'chevron-up' : 'chevron-down'} /> {t('Template for new presets')}
            </button>
            {open && (
                <div className="mdb2-template-body">
                    <label className="mdb2-param">
                        <span>{t('Type')}</span>
                        <select className="mdb2-select" value={template.type}
                            onChange={e => change({ template: { ...template, type: e.target.value } })}>
                            {Object.keys(OPERATION_TYPES).map(type => <option key={type}>{type}</option>)}
                        </select>
                    </label>
                    <ParamRows preset={template} editable={!group._locked}
                        onChangeParam={(name, v) => change({ template: { ...template, params: { ...template.params, [name]: v } } })} />
                </div>
            )}
        </div>
    )
}

export default function MaterialDb2({ mode = 'manage', show, onHide, types, onApplyPreset }) {
    const dispatch = useDispatch()
    const groups = useSelector(s => s.materialDatabase)
    const defaultProfile = useSelector(s => s.settings.__selectedProfile)
    const [groupId, setGroupId] = useState(null)
    const [search, setSearch] = useState('')
    const [profileFilter, setProfileFilter] = useState(mode === 'pick' ? (defaultProfile ?? '*') : '*')

    if (!show) return null

    const q = search.trim().toLowerCase()
    const presetMatches = p =>
        matchesProfile(p, profileFilter) &&
        (!q || (p.name + ' ' + (p.notes || '') + ' ' + p.type).toLowerCase().includes(q))
    const visibleGroups = groups.filter(g =>
        (!q || g.name.toLowerCase().includes(q) || g.presets.some(presetMatches)))
    const group = groups.find(g => g.id === groupId) || visibleGroups[0]
    const presets = group ? group.presets.filter(presetMatches) : []

    const apply = preset => {
        onApplyPreset && onApplyPreset(preset.type, presetToOperationAttrs(preset))
        onHide()
    }
    const exportDb = format => {
        if (format === 'json') FileStorage.save('laserweb-materials', stringify(groups), 'application/json')
        else FileStorage.save('laserweb-materials', arr2csv(materialTreeToTabular(groups)), 'text/csv')
        dispatch(downloadMaterialDatabase(groups))
    }
    const importDb = e =>
        FileStorage.load(e.target.files[0], (file, result) => dispatch(uploadMaterialDatabase(file, result)))

    return ReactDOM.createPortal(
        <div className="mdb2-overlay" onClick={e => { if (e.target === e.currentTarget) onHide() }}>
            <div className="mdb2" role="dialog">
                <header className="mdb2-header">
                    <div>
                        <h1>{mode === 'pick' ? t('Apply a material preset') : t('Material library')}</h1>
                        <p>{mode === 'pick'
                            ? t('Proven speed/power/passes per material — pick one and the operation takes its values')
                            : t('Your proven recipes per material, grouped and reusable')}</p>
                    </div>
                    <input className="mdb2-search" placeholder={t('Search material or preset...')}
                        value={search} onChange={e => setSearch(e.target.value)} />
                    <ProfileFilter value={profileFilter} onChange={setProfileFilter} />
                    <button className="d2-btn" onClick={onHide} title={t('Close')}><Icon name="times" /></button>
                </header>

                <div className="mdb2-body">
                    <nav className="mdb2-rail">
                        {mode === 'manage' && (
                            <button className="d2-btn d2-btn-go mdb2-add-group" onClick={() => dispatch(addGroup())}>
                                <Icon name="plus" /> {t('New material')}
                            </button>
                        )}
                        {visibleGroups.map(g => (
                            <button key={g.id}
                                className={'mdb2-group' + ((group && g.id === group.id) ? ' active' : '')}
                                onClick={() => setGroupId(g.id)}>
                                <strong>
                                    {g.name}
                                    {g._locked ? <Icon name="lock" title={t('Bundled group: resets on restart')} /> : null}
                                </strong>
                                <small>{g.presets.length} {t('presets')}{g.notes ? ' · ' + g.notes : ''}</small>
                            </button>
                        ))}
                        {!visibleGroups.length && <div className="mdb2-empty">{t('No materials match the search')}</div>}
                    </nav>

                    <section className="mdb2-main">
                        {group ? (
                            <React.Fragment>
                                <div className="mdb2-group-head">
                                    {(mode === 'manage' && !group._locked) ? (
                                        <React.Fragment>
                                            <input className="mdb2-name big" value={group.name}
                                                onChange={e => dispatch(setGroupAttrs(group.id, { name: e.target.value }))} />
                                            <input className="mdb2-notes" placeholder={t('Notes')} value={group.notes || ''}
                                                onChange={e => dispatch(setGroupAttrs(group.id, { notes: e.target.value }))} />
                                        </React.Fragment>
                                    ) : (
                                        <React.Fragment>
                                            <h2>{group.name} {group._locked ? <Icon name="lock" /> : null}</h2>
                                            {group.notes ? <p>{group.notes}</p> : null}
                                        </React.Fragment>
                                    )}
                                    {mode === 'manage' && (
                                        <div className="mdb2-group-actions">
                                            <button className="d2-btn d2-btn-go" disabled={group._locked}
                                                onClick={() => dispatch(addPreset(group.id))}>
                                                <Icon name="plus" /> {t('Add preset')}
                                            </button>
                                            <button className="d2-btn d2-btn-danger" disabled={group._locked}
                                                title={t('Delete this material and all its presets')}
                                                onClick={() => confirm(t('Delete this material and all its presets?'),
                                                    ok => { if (ok) { dispatch(deleteGroup(group.id)); setGroupId(null) } })}>
                                                <Icon name="trash" />
                                            </button>
                                        </div>
                                    )}
                                </div>
                                {mode === 'manage' && !group._locked ? <GroupTemplate group={group} /> : null}
                                {presets.map(p => (
                                    <PresetCard key={p.id} preset={p} mode={mode} locked={group._locked}
                                        disabled={mode === 'pick' && types && !types.includes(p.type)}
                                        onApply={apply} />
                                ))}
                                {!presets.length && <div className="mdb2-empty">{t('No presets here (yet) — or the machine filter hides them')}</div>}
                            </React.Fragment>
                        ) : <div className="mdb2-empty">{t('Pick a material on the left')}</div>}
                    </section>
                </div>

                {mode === 'manage' && (
                    <footer className="mdb2-footer">
                        <span>{t('Locked groups ship with LaserWeb and reset on restart')}</span>
                        <div>
                            <button className="d2-btn" onClick={() => exportDb('json')}><Icon name="download" /> .json</button>
                            <button className="d2-btn" onClick={() => exportDb('csv')}><Icon name="download" /> .csv</button>
                            <FileField onChange={importDb} accept="application/json, .json">
                                <button className="d2-btn"><Icon name="upload" /> {t('Import .json')}</button>
                            </FileField>
                        </div>
                    </footer>
                )}
            </div>
        </div>,
        document.body
    )
}
