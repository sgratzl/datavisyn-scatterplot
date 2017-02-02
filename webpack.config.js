const webpack = require('webpack');
const path = require('path');

const pkg = require('./package.json');
const year = (new Date()).getFullYear();
const banner = '/*! ' + (pkg.title || pkg.name) + ' - v' + pkg.version + ' - ' + year + '\n' +
  (pkg.homepage ? '* ' + pkg.homepage + '\n' : '') +
  '* Copyright (c) ' + year + ' ' + pkg.author.name + ';' +
  ' Licensed ' + pkg.license + '*/\n';

module.exports = function (env) {
  const isProduction = env === 'prod';
  const base = {
    entry: {
      scatterplot: [path.resolve(__dirname, 'src/index.ts')]
    },
    output: {
      path: path.resolve(__dirname, 'build'),
      publicPath: '',
      filename: '[name].js',
      libraryTarget: 'umd',
      library: ['datavisyn', 'scatterplot']
    },
    module: {
      loaders: [{
        test: /\.tsx?$/,
        loader: 'awesome-typescript-loader'
      }, {
        test: /\.scss$/,
        loader: 'style-loader!css-loader!sass-loader'
      }]
    },
    resolve: {
      extensions: ['.webpack.js', '.web.js', '.ts', '.tsx', '.js'],

      modules: [path.resolve(__dirname, 'src'), 'node_modules']
    },
    plugins: [
      new webpack.BannerPlugin({
        banner: banner,
        raw: true
      }),
      new webpack.DefinePlugin({
       'process.env': {
         'NODE_ENV': JSON.stringify(isProduction ? 'production': 'development')
       }
   })
    ],
    devServer: {
      contentBase: path.resolve(__dirname, 'build')
    },
    devtool: 'source-map'
  };
  return base;
};
