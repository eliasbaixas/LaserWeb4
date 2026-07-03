const { merge } = require('webpack-merge');
const common = require('./webpack.common.js');

module.exports = merge(common, {
    mode: 'development',
    devtool: 'source-map',
    devServer: {
        static: './dist',
        // Pretty pane URLs (/files, /control, ...) are client-side routes
        historyApiFallback: true,
        // TODO: Enable once HMR can work reliably; it currently seems to break on LaserWeb's use of features (soft-)deprecated in React 17/18
        hot: false
    },
});
