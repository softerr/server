const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { HotModuleReplacementPlugin } = require('webpack');

module.exports = {
    entry: './src/index.js',
    mode: 'development',
    devtool: 'inline-source-map',
    output: {
        filename: '[name].js',
        path: path.resolve(__dirname, 'public'),
        publicPath: '/',
        clean: true,
    },
    plugins: [
        new HtmlWebpackPlugin({
            title: 'Home',
        }),
        new HotModuleReplacementPlugin(),
    ],
    devServer: {
        port: 3000,
        hot: true,
        historyApiFallback: true,
    },
    optimization: {
        runtimeChunk: 'single',
    },
    module: {
        rules: [
            {
                test: /\.css$/i,
                use: ['style-loader', 'css-loader'],
            }
        ],
    }
};