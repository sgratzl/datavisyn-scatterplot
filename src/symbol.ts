/**
 * author:  Samuel Gratzl
 * email:   samuel_gratzl@gmx.at
 * created: 2016-10-28T11:19:52.797Z
 */

import {
  symbolCircle,
  symbolCross,
  symbolDiamond,
  symbolSquare,
  symbolStar,
  symbolTriangle,
  symbolWye,
  SymbolType
} from 'd3-shape';
import merge from './merge';

/**
 * a symbol renderer renderes a bunch of data points using `render` at the end `done` will be called
 */
export interface ISymbolRenderer<T> {
  render(x: number, y: number, d: T);
  done();
}

/**
 * rendering mode for different kind of renderings
 */
export enum ERenderMode {
  NORMAL,
  SELECTED,
  HOVER
}

export interface IRenderInfo {
  /**
   * current zoomLevel
   */
  zoomLevel: number;
}
/**
 * factory for creating symbols renderers
 */
export interface ISymbol<T> {
  /**
   * @param ctx the context to use
   * @param mode the current render mode
   * @param config additional config information
   * @returns a symbol renderer
   */
  (ctx: CanvasRenderingContext2D, mode: ERenderMode, renderInfo: IRenderInfo): ISymbolRenderer<T>;
}

export interface ISymbolOptions {
  fillColor?: string;
  hoverColor?: string;
  selectedColor?: string;
  symbolSize?: number;
}

export const d3SymbolCircle: SymbolType = symbolCircle;
export const d3SymbolCross: SymbolType = symbolCross;
export const d3SymbolDiamond: SymbolType = symbolDiamond;
export const d3SymbolSquare: SymbolType = symbolSquare;
export const d3SymbolStar: SymbolType = symbolStar;
export const d3SymbolTriangle: SymbolType = symbolTriangle;
export const d3SymbolWye: SymbolType = symbolWye;

/**
 * generic wrapper around d3 symbols for rendering
 * @param symbol the symbol to render
 * @param fillStyle the style applied
 * @param size the size of the symbol
 * @returns {function(CanvasRenderingContext2D): undefined}
 */
export function d3Symbol(symbol: SymbolType = d3SymbolCircle, fillStyle: string = 'steelblue', size = 5): ISymbol<any> {
  return (ctx: CanvasRenderingContext2D) => {
    //before
    ctx.beginPath();
    return {
      //during
      render: (x: number, y: number) => {
        ctx.translate(x, y);
        symbol.draw(ctx, size);
        ctx.translate(-x, -y);
      },
      //after
      done: () => {
        ctx.closePath();
        ctx.fillStyle = fillStyle;
        ctx.fill();
      }
    };
  };
}

/**
 * circle symbol renderer (way faster than d3Symbol(d3symbolCircle)
 * @param fillStyle
 * @param size
 * @returns {function(CanvasRenderingContext2D): undefined}
 */

const defaultOptions: ISymbolOptions = {
    fillColor: 'steelblue',
    selectedColor: 'red',
    hoverColor: 'orange',
    symbolSize: 20
  };

export function circleSymbol(params?: ISymbolOptions): ISymbol<any> {
  const options = merge(defaultOptions, params || {});

  const r = Math.sqrt(options.symbolSize / Math.PI);
  const tau = 2 * Math.PI;

  const styles = {
    [ERenderMode.NORMAL]: options.fillColor,
    [ERenderMode.HOVER]: options.hoverColor,
    [ERenderMode.SELECTED]: options.selectedColor
  };

  return (ctx: CanvasRenderingContext2D, mode: ERenderMode) => {
    //before
    ctx.beginPath();
    return {
      //during
      render: (x: number, y: number) => {
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, tau);
      },
      //after
      done: () => {
        ctx.closePath();
        ctx.fillStyle = styles[mode];
        ctx.fill();
      }
    };
  };
}

export function squareSymbol(params?: ISymbolOptions) {
  const options = merge(defaultOptions, params || {});

  const length = Math.sqrt(options.symbolSize);

  const styles = {
    [ERenderMode.NORMAL]: options.fillColor,
    [ERenderMode.HOVER]: options.hoverColor,
    [ERenderMode.SELECTED]: options.selectedColor
  };

  return(ctx: CanvasRenderingContext2D, mode: ERenderMode) => {
    ctx.beginPath();
    return {
      render: (x: number, y: number) => {
        ctx.rect(x - length / 2, y - length / 2, length, length);
      },
      done: () => {
        ctx.closePath();
        ctx.fillStyle = styles[mode];
        ctx.fill();
      }
    };
  };
}

export function diamondSymbol(params?: ISymbolOptions) {
  const options = merge(defaultOptions, params || {});

  const tan30 = Math.sqrt(1/3);
  const tan30Double = tan30 * 2;
  const moveYAxis = Math.sqrt(options.symbolSize / tan30Double);
  const moveXAxis = moveYAxis * tan30;

  const styles = {
    [ERenderMode.NORMAL]: options.fillColor,
    [ERenderMode.HOVER]: options.hoverColor,
    [ERenderMode.SELECTED]: options.selectedColor
  };

  return(ctx: CanvasRenderingContext2D, mode: ERenderMode) => {
    ctx.beginPath();
    return {
      render: (x: number, y: number) => {
        ctx.moveTo(x, y - moveYAxis);
        ctx.lineTo(x - moveXAxis, y);
        ctx.lineTo(x, y + moveYAxis);
        ctx.lineTo(x + moveXAxis, y);
        ctx.closePath();
      },
      done: () => {
        ctx.closePath();
        ctx.fillStyle = styles[mode];
        ctx.fill();
      }
    };
  };
}
