/**
 * Onboarding card for the Files pane. Shown while the workspace is empty
 * (no documents, no operations); collapsible, and the collapsed state is
 * remembered in localStorage.
 * @module
 */

import React, { useState } from 'react'
import { useSelector } from 'react-redux'

import Icon from './font-awesome'

const COLLAPSED_KEY = 'LaserWeb.camGuideCollapsed'

function Term({ icon, name, children }) {
    return (
        <p style={{ marginBottom: 6 }}>
            <strong><Icon name={icon} fw /> {name}</strong> — {children}
        </p>
    )
}

export function CamGuide() {
    const empty = useSelector(s => s.documents.length === 0 && s.operations.length === 0)
    const [collapsed, setCollapsed] = useState(
        () => window.localStorage.getItem(COLLAPSED_KEY) === 'true')

    if (!empty) return null

    const toggle = () => {
        window.localStorage.setItem(COLLAPSED_KEY, String(!collapsed))
        setCollapsed(!collapsed)
    }

    return (
        <div className="panel panel-primary" style={{ marginBottom: 3, flexShrink: 0 }}>
            <div className="panel-heading" style={{ padding: '3px 8px', cursor: 'pointer' }} onClick={toggle}
                title={collapsed ? 'Expand the quick guide' : 'Collapse the quick guide'}>
                <label style={{ cursor: 'pointer', marginBottom: 0 }}>
                    <Icon name="graduation-cap" /> New here? How LaserWeb works
                </label>
                <span style={{ float: 'right' }}><Icon name={collapsed ? 'chevron-down' : 'chevron-up'} /></span>
            </div>
            {!collapsed &&
                <div className="panel-body" style={{ padding: 8, fontSize: 12, overflowY: 'auto', maxHeight: '45vh' }}>
                    <Term icon="th" name="Workspace">
                        the virtual bed of your machine, drawn to real size on the right
                        (the grid). Documents, generated toolpaths and the live position
                        cursor all live there. The <em>Workspace</em> toolbar above saves or
                        restores everything (documents + operations) as a snapshot file.
                    </Term>
                    <Term icon="file-image-o" name="Document">
                        a design file you import with <em>Add Document</em>: vector
                        (SVG, DXF) or bitmap (PNG, JPG, BMP) — or ready-made G-code. It
                        appears in the document tree and on the workspace, where you can
                        select, move and resize it.
                    </Term>
                    <Term icon="industry" name="Operation">
                        what to do with a document: <em>Laser Cut</em> follows vector
                        paths, <em>Laser Raster</em> engraves bitmaps line by line, etc.
                        Drag a document from the tree onto the <em>Operations</em> area
                        below and set its parameters (speed, power, passes).
                    </Term>
                    <Term icon="file-code-o" name="G-code">
                        the machine's own language: a plain-text list of moves and tool
                        commands (<code>G0</code>/<code>G1</code> to travel,{' '}
                        <code>M3</code>/<code>M4</code>/<code>M5</code> for tool on/off).{' '}
                        <em>Generate</em> compiles your operations into G-code and previews
                        the resulting toolpath on the workspace.
                    </Term>
                    <hr style={{ margin: '8px 0' }} />
                    <strong><Icon name="road" fw /> The flow</strong>
                    <ol style={{ marginBottom: 0, paddingLeft: 20 }}>
                        <li><em>Add Document</em> and place it on the workspace</li>
                        <li>Drag it onto <em>Operations</em> and pick the operation type</li>
                        <li>Tune the parameters (feed, power, passes)</li>
                        <li><em>Generate</em> and check the toolpath preview</li>
                        <li>Connect in <em>Comms</em>, then run the job and watch it in <em>Control</em></li>
                    </ol>
                </div>}
        </div>
    )
}

export default CamGuide
