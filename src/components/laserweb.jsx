/**
 * LaserWeb main module (layout).
 * - Create the main layout.
 * - Set initial state.
 * @module
 */

// Styles/Fonts
import 'bootstrap'
import 'bootstrap/dist/css/bootstrap.min.css'
// Bootstrap 5 utility classes only (d-flex, gap-*, p-*/m-*, text-*, ...):
// coexists with BS3 components so new/updated markup can use modern utils.
import 'bootstrap5/dist/css/bootstrap-utilities.min.css'
import '@fontsource/space-grotesk/400.css'
import '@fontsource/space-grotesk/600.css'
import '@fontsource/space-grotesk/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '../styles/theme2.css'
import '../styles/design2.css'
import 'font-awesome/css/font-awesome.min.css'
import 'react-select/dist/react-select.css';
import '../styles/index.css'
import '../styles/resizer.css';
import 'bootstrap-range-input/dist/css/bootstrap-range-input.min.css'

// React/Redux
import React from 'react'
import { connect } from 'react-redux'

// Main components
import Sidebar from './sidebar'
import WorkspaceSwitcher from './workspace-switcher'
import AppShell2 from './app-shell2'

// Inner components
import Com from './com'
import ControlSwitcher from './control-switcher'
import WorkshopSwitcher from './workshop-switcher'
import Quote from './quote'
import Settings from './settings'
import About from './about'
import ConnectionStatus from './connection-status'
import { t } from '../lib/i18n'

import { AllowCapture } from './capture'
import { DocumentCacheHolder } from './document-cache'

import { keyboardUndoAction } from '../actions/laserweb';

import { keyboardLogger, bindKeys, unbindKeys } from './keyboard';

import { fireMacroById } from '../actions/macros'

import { GlobalStore } from '../index'

import { VideoCapture } from '../lib/video-capture'
import { fetchRelease } from '../lib/releases'

import { DrawCommands } from '../draw-commands'

import vex from '../lib/vex'

import { version } from '../reducers/settings'

import { setSettingsAttrs } from '../actions/settings'

/**
 * LaserWeb main component (layout).
 * - Create the main layout.
 *
 * @extends module:react~React~Component
 * @param {Object} props Component properties.
 */

export const confirm = (message, callback, skip=false) => {
    if (skip) return callback(true);
    vex.dialog.confirm({ message, callback })
}

export const prompt = (message, placeholder, callback, skip) => {
    if (skip) return callback(placeholder);
    vex.dialog.open({
        message,
        input: `<input name="prompt" type="text" placeholder="${placeholder}" value="${placeholder}"  />`,
        buttons: [
            $.extend({}, vex.dialog.buttons.YES, { text: 'Ok' }),
            $.extend({}, vex.dialog.buttons.NO, { text: 'Cancel' })
        ],
        callback: function (data) {
            if (data===false) {
                callback(null)
            } else {
                callback(data.prompt || "")
            }
        }
    })
}

export const alert = (unsafeMessage) => {
    vex.dialog.alert({ unsafeMessage })
}

const updateTitle=()=>{
    document.title = `Laserweb ${version}`;
}

class LaserWeb extends React.Component {
    constructor(props) {
        super(props)
        this.state = {
            appShell2: window.localStorage.getItem('LaserWeb.appShell2') === 'true' || /[?&]ui2=1/.test(window.location.search)
        }
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        updateTitle();
    }

    shouldComponentUpdate(nextProps, nextState) {
        return nextProps.documents !== this.props.documents || nextState.appShell2 !== this.state.appShell2;
    }

    UNSAFE_componentWillMount() {
        try {
            let canvas = document.createElement('canvas');
            let gl = canvas.getContext('webgl', { alpha: true, depth: true, antialias: true, preserveDrawingBuffer: true });
            if (!gl)
                throw "canvas.getContext('webgl', {...}) returned " + gl;
            let drawCommands = new DrawCommands(gl);
            drawCommands.destroy();
            this.glOk = true;
        } catch (e) {
            console.error(e);
            return;
        }
    }

    componentDidMount() {
        updateTitle();
        if (this.glOk) {
            this.setupKeybindings();
            this.setupVideoCapture();
        }
        fetchRelease().then(function(data){
            if (this.props.settings.__latestRelease) {
                if (Math.abs(new Date(data.created_at).getTime() - new Date(this.props.settings.__latestRelease).getTime()))
                {
                    alert(`New release (<a href="${data.html_url}" target="__blank">${data.tag_name}</a>) available`);
                }
            }
            this.props.dispatch(setSettingsAttrs({__latestRelease: data.created_at}))
        }.bind(this))
    }

    setupKeybindings(){
            keyboardLogger.bind(['command + z', 'ctrl + z'], function (e) {
                this.props.handleUndo(e);
            }.bind(this));

            Object.entries(this.props.macros).filter(entry=>{
                    let [label, macro] = entry;
                    return macro.keybinding && macro.keybinding.length
                }).map(entry=>{
                    let [label, macro] = entry;
                    return macro.keybinding
                }).forEach((key)=>{
                    keyboardLogger.bind(key, function (e) { this.props.handleMacro(e, key, this.props.macros) }.bind(this))
                });
    }

    setupVideoCapture()
    {
        if (!window.videoCapture) {
            const onNextFrame = (callback) => { setTimeout(() => { window.requestAnimationFrame(callback) }, 0) }
            onNextFrame(() => {
                window.videoCapture = new VideoCapture()
                window.videoCapture.scan(this.props.settings.toolVideoDevice, this.props.settings.toolVideoResolution, (obj) => { this.props.handleVideoStream(this.props.settings.toolVideoDevice, obj) })
            })
        }
    }


    render() {
        // 2017-01-21 Pvdw - removed the following from Dock
        // <Gcode id="gcode" title="G-Code" icon="file-code-o" />
        // <Quote id="quote" title="Quote" icon="money" />

        if (!this.glOk) {
            return (
                <h1>OpenGL won't start. This app can't run without it.</h1>
            );
        }

        const panes = (
            <Sidebar ref="sidebar"
                hideDock={this.state.appShell2}
                initialSize={this.state.appShell2 ? 398 : 300}
                style={{ flexGrow: 0, flexShrink: 0 }}>
                <WorkshopSwitcher id="cam" title={t("Files")} icon="pencil-square-o" />
                <Com id="com" title={t("Comms")} icon="plug" />
                <ControlSwitcher id="jog" title={t("Control")} icon="arrows-alt" />
                <Settings id="settings" title={t("Settings")} icon="cogs" />
                <About id="about" title={t("About")} icon="question" />
            </Sidebar>
        )

        const body = (
            <div style={{ display: 'flex', flexDirection: 'row', height: '100%', flex: 1, minWidth: 0 }}>
                {panes}
                <WorkspaceSwitcher />
                <ConnectionStatus />
            </div>
        )

        const setClassic = () => {
            window.localStorage.setItem('LaserWeb.appShell2', 'false')
            this.setState({ appShell2: false })
        }

        return (
            <AllowCapture style={{ height: '100%' }}>
                <DocumentCacheHolder style={{ width: '100%' }} documents={this.props.documents}>
                    {this.state.appShell2 ? (
                        <AppShell2 onClassic={setClassic}>{body}</AppShell2>
                    ) : (
                        <div style={{ height: '100%', position: 'relative' }}>
                            {body}
                            <button onClick={() => { window.localStorage.setItem('LaserWeb.appShell2', 'true'); this.setState({ appShell2: true }) }}
                                title={t('Try UI 2.0')}
                                style={{ position: 'absolute', top: 10, left: 92, zIndex: 8, padding: '3px 10px', borderRadius: 12, fontSize: 12, border: '1px solid #4da3ff55', cursor: 'pointer', background: 'rgba(20,23,28,.75)', color: '#4da3ff' }}>
                                {t('UI 2.0')}
                            </button>
                        </div>
                    )}
                </DocumentCacheHolder>
            </AllowCapture>
        )
    }
}

const mapStateToProps = (state) => {
    return {
        macros: state.settings.macros,
        visible: state.panes.visible,
        documents: state.documents,
        settings: state.settings,
    }
}

const mapDispatchToProps = (dispatch) => {
    return {
        dispatch,
        handleUndo: evt => {
            evt.preventDefault();
            dispatch(keyboardUndoAction(evt))
        },
        handleMacro: (evt, key, macros) => {
            let macroAction = fireMacroById(key, macros)
            if (macroAction) {
                evt.preventDefault();
                dispatch(macroAction)
            }
        },
        handleVideoStream: (deviceId, props) => {
            if (props === false) dispatch({ type: "SETTINGS_SET_ATTRS", payload: { attrs: { toolVideoDevice: null } } })
        }

    }
}

// Exports
export { LaserWeb }
export default connect(mapStateToProps, mapDispatchToProps)(LaserWeb)
