import { objectNoId } from '../reducers/object'

export const COM_INITIALSTATE = {
    serverConnected: false,
    machineConnected: false,
    playing: false,
    paused:false,
    firmware: '',
    firmwareVersion: '',

    machineStatus: '',      // GRBL state: Idle | Run | Hold | Home | Alarm
    queued: 0,              // lines waiting in the server queue
    jobPercent: null,       // % sent of the running job (null when no job)
    feedOverride: 100,      // live F override as last reported by the machine
    spindleOverride: 100,   // live S override as last reported by the machine

    comInterfaces:[],
    comPorts:[]
}

export function com(state = COM_INITIALSTATE, action) {
    state = objectNoId('com', COM_INITIALSTATE)(state, action);
    return state;
}
