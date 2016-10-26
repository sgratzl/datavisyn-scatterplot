import {axisLeft, axisBottom, AxisScale} from 'd3-axis';
import * as d3scale from 'd3-scale';
import {symbolCircle, symbolCross, symbolDiamond, symbolSquare, symbolStar, symbolTriangle, symbolWye, line as d3line} from 'd3-shape';
import {select} from 'd3-selection';
import {zoom, zoomTransform, ZoomScale} from 'd3-zoom';
import {quadtree, Quadtree, QuadtreeInternalNode, QuadtreeLeaf} from 'd3-quadtree';

export interface IScale extends AxisScale<number>, ZoomScale {
  range(range:number[]);
  range(): number[];
  domain(): number[];
  domain(domain: number[]);
  invert(v: number): number;
  copy(): IScale;
}

export interface IAccessor<T> {
  (v:T) : number;
}


export interface ISymbolRenderer<T> {
  render(x:number, y:number, d:T);
  done();
}

export enum ERenderMode {
  NORMAL,
  SELECTED,
  HOVER
}

export interface ISymbol<T> {
  (ctx:CanvasRenderingContext2D, mode: ERenderMode): ISymbolRenderer<T>;
}

/**
 * generic wrapper around d3 symbols for rendering
 * @param symbol the symbol to render
 * @param fillStyle the style applied
 * @param size the size of the symbol
 * @returns {function(CanvasRenderingContext2D, IPoorManIterator): undefined}
 */
export function d3Symbol(symbol = d3SymbolCircle, fillStyle:string = 'steelblue', size = 5):ISymbol<any> {
  return (ctx:CanvasRenderingContext2D) => {
    //before
    ctx.beginPath();
    return {
      //during
      render: (x:number, y:number) => {
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
  }
}

/**
 * circle symbol renderer (way faster than d3Symbol(d3symbolCircle)
 * @param fillStyle
 * @param size
 * @returns {function(CanvasRenderingContext2D, IPoorManIterator): undefined}
 */
export function circleSymbol(fillStyle:string = 'steelblue', size = 20):ISymbol<any> {
  const r = Math.sqrt(size / Math.PI);
  const tau = 2 * Math.PI;

  const styles = {
    [ERenderMode.NORMAL]: fillStyle,
    [ERenderMode.HOVER]: 'orange',
    [ERenderMode.SELECTED]: 'red'
  };

  return (ctx:CanvasRenderingContext2D, mode : ERenderMode) => {
    //before
    ctx.beginPath();
    return {
      //during
      render: (x:number, y:number) => {
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
  }
}

export interface IScatterplotOptions<T> {
  /**
   * default: 20
   */
  margin?: {
    left?: number;
    top?: number;
    right?: number;
    bottom?: number;
  };

  scaleExtent?: [number, number];

  /**
   * x accessor of the data
   * @param d
   */
  x:IAccessor<T>;

  /**
   * y accessor of the data
   * @param d
   */
  y:IAccessor<T>;

}

/**
 * a class for rendering a scatterplot in a canvas
 */
export default class Scatterplot<T> {
  /**
   * x scale applied to value
   */
  xscale:IScale = d3scale.scaleLinear().domain([0, 100]);

  /**
   * y scale applied to valuee
   */
  yscale:IScale = d3scale.scaleLinear().domain([0, 100]);

  symbol:ISymbol<T> = circleSymbol();

  private canvas:HTMLCanvasElement;

  private options:IScatterplotOptions<T> = {
    margin: {
      left: 40,
      top: 10,
      bottom: 20,
      right: 10
    },
    scaleExtent: [1 / 2, 4],
    x: (d) => (<any>d).x,
    y: (d) => (<any>d).y
  };

  private zoom = zoom().on('zoom', this.onZoom.bind(this));

  private tree:Quadtree<T>;
  private _selection : Quadtree<T>;

  constructor(data:T[], private parent:HTMLElement, options?:IScatterplotOptions<T>) {
    //TODO merge options

    //init dom
    parent.innerHTML = `
      <canvas style="position: absolute; z-index: 1; width: 100%; height: 100%;"></canvas>
      <svg style="position: absolute; z-index: 2; width: ${this.options.margin.left + 2}px; height: 100%;">
        <g transform="translate(${this.options.margin.left},0)"><g>
      </svg>
      <svg style="position: absolute; z-index: 3; width: 100%; height: ${this.options.margin.bottom}px; bottom: 0">
        <g><g>
      </svg>
    `;
    parent.style.position = 'relative';

    this.canvas = <HTMLCanvasElement>parent.children[0];

    //register zoom
    this.zoom
      .scaleExtent(this.options.scaleExtent);
    select(this.canvas).call(this.zoom);

    //generate a quad tree out of the data
    this.tree = quadtree(data, this.options.x, this.options.y);
    this._selection = quadtree([], this.options.x, this.options.y);
  }

  checkResize() {
    const c = this.canvas;
    if (c.width !== c.clientWidth || c.height !== c.clientHeight) {
      c.width = c.clientWidth;
      //this.svg.width = c.clientWidth;
      c.height = c.clientHeight;
      //this.svg.height = c.clientHeight;
      return true;
    }
    return false;
  }

  private get ctx() {
    return this.canvas.getContext('2d');
  }

  get selection() {
    return this._selection.data();
  }

  set selection(selection: T[]) {
    if (selection.length === 0) {
      if (this._selection.size() === 0) {
        return;
      }
      this._selection = quadtree([], this.options.x, this.options.y);
      this.render();
      return;
    }
    //find the delta
    var changed = false;
    const s = this.selection;
    selection.forEach((s_new) => {
      const i = s.indexOf(s_new);
      if (i < 0) { //new
        this._selection.add(s_new);
        changed = true;
      } else {
        s.splice(i, 1); //mark as used
      }
    });
    changed = changed || s.length > 0;
    //remove removed items
    this._selection.removeAll(s);

    if (changed) {
      this.render();
    }
  }

  addToSelection(items: T[]) {
    if (items.length === 0) {
      return;
    }
    this._selection.addAll(items);
    this.render();
  }

  removeFromSelection(items: T[]) {
    if (items.length === 0) {
      return;
    }
    this._selection.removeAll(items);
    this.render();
  }

  render() {
    const c = this.canvas,
      ctx = this.ctx,
      margin = this.options.margin,
      bounds = { x0: margin.left, y0: margin.top, x1: c.clientWidth - margin.right, y1: c.clientHeight - margin.bottom};
    this.checkResize();

    this.xscale.range([bounds.x0, bounds.x1]);
    this.yscale.range([bounds.y1, bounds.y0]);

    //transform scale
    const transform = zoomTransform(this.canvas);
    const xscale = transform.rescaleX(this.xscale);
    const yscale = transform.rescaleY(this.yscale);

    this.renderAxes(xscale, yscale);

    ctx.clearRect(0, 0, c.width, c.height);

    ctx.save();

    ctx.rect(bounds.x0, bounds.y0, bounds.x1 - bounds.x0, bounds.y1 - bounds.y0);
    ctx.clip();

    this.renderPoints(ctx, xscale, yscale, bounds);

    ctx.restore();
  }

  private onZoom() {
    this.render();
  }

  private renderAxes(xscale: IScale, yscale: IScale) {
    const left = axisLeft(yscale),
      bottom = axisBottom(xscale),
      $parent = select(this.parent);
    $parent.select('svg g').call(left);
    $parent.select('svg:last-of-type g').call(bottom);
  }

  private renderPoints(ctx:CanvasRenderingContext2D, xscale: IScale, yscale: IScale, bounds: {x0: number, y0: number, x1: number, y1: number}) {
    const {x, y} = this.options;
    var renderer: ISymbolRenderer<T> = null;

    function debugNode(color: string, x0: number, y0: number, x1: number, y1: number) {
      ctx.closePath();
      ctx.fillStyle = 'steelblue';
      ctx.fill();
      ctx.fillStyle = color;
      x0 = xscale(x0);
      y0 = yscale(y0);
      x1 = xscale(x1);
      y1 = yscale(y1);
      ctx.fillRect(Math.min(x0,x1),Math.min(y0,y1),Math.abs(x0-x1),Math.abs(y0-y1));
      ctx.beginPath();

    }

    const dbounds = {
      x0: xscale.invert(bounds.x0),
      x1: xscale.invert(bounds.x1),
      //since y domain is inverted
      y1: yscale.invert(bounds.y0),
      y0: yscale.invert(bounds.y1),
    };

    function isVisible(x0: number, y0: number, x1: number, y1: number) {
      //if the 1er points are small than 0er or 0er bigger than 1er than outside
      if (x1 < dbounds.x0 || y1 < dbounds.y0 || x0 > dbounds.x1 || y0 > dbounds.y1) {
        //debugNode('rgba(255,0,0,0.2)', x0, y0, x1, y1);
        return false;
      }
      //debugNode('rgba(0,255,0,0.2)', x0, y0, x1, y1);
      //inside or partial overlap
      return true;
    }

    function visitTree(node:QuadtreeInternalNode<T> | QuadtreeLeaf<T>, x0: number, y0: number, x1: number, y1: number) {
      if (!(<any>node).length) { //is a leaf
        var leaf = <QuadtreeLeaf<T>>node;
        //see https://github.com/d3/d3-quadtree
        do {
          let d = leaf.data;
          renderer.render(xscale(x(d)), yscale(y(d)), d);
          //console.log(x(d), y(d), '=',xscale(x(d)), yscale(y(d)));
        } while ((leaf = leaf.next) != null);
        return true; //don't visit
      } else {
        //console.log(x0,y0,x1,y1, '=',xscale(x0), yscale(y0), xscale(x1), yscale(y1));
        //negate, since true means not visit
        return !isVisible(x0, y0, x1, y1);
      }
    }

    ctx.save();

    renderer = this.symbol(ctx, ERenderMode.NORMAL);
    this.tree.visit(visitTree);
    renderer.done();

    //render selected
    renderer = this.symbol(ctx, ERenderMode.SELECTED);
    this._selection.visit(visitTree);
    renderer.done();

    //a dummy path to clear the 'to draw' state
    ctx.beginPath();
    ctx.closePath();

    ctx.restore();
  }


  private renderLasso(ctx: CanvasRenderingContext2D) {
    ctx.save();

    ctx.restore();
  }
}

/**
 * reexport d3 scale
 */
export const scale = d3scale;

export const d3SymbolCircle = symbolCircle;
export const d3SymbolCross = symbolCross;
export const d3SymbolDiamond = symbolDiamond;
export const d3SymbolSquare = symbolSquare;
export const d3SymbolStar = symbolStar;
export const d3SymbolTriangle = symbolTriangle;
export const d3SymbolWye = symbolWye;

export function create<T>(data:T[], canvas:HTMLCanvasElement):Scatterplot<T> {
  return new Scatterplot(data, canvas);
}
