/**
 * Error boundary: contains render crashes to the subtree that failed
 * instead of unmounting the whole app (blank page). Shows the error and
 * offers a retry (remount) button.
 * @module
 */

import React from 'react'
import { t } from '../lib/i18n'

export default class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props)
        this.state = { error: null }
    }

    static getDerivedStateFromError(error) {
        return { error }
    }

    componentDidCatch(error, info) {
        console.error('[ErrorBoundary]', this.props.label || '', error, info.componentStack)
    }

    render() {
        if (this.state.error) {
            return (
                <div className="alert alert-danger" style={{ margin: 8 }}>
                    <p><strong>{t("This panel crashed.")}</strong> {t("The rest of the app keeps working.")}</p>
                    <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>{String(this.state.error)}</pre>
                    <button className="btn btn-xs btn-default" onClick={() => this.setState({ error: null })}>
                        {t("Try again")}
                    </button>
                </div>
            )
        }
        return this.props.children
    }
}
