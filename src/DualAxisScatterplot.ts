/**
 * author:  Samuel Gratzl
 * email:   samuel_gratzl@gmx.at
 * created: 2016-10-28T11:19:52.797Z
 */

import {axisLeft, axisBottom, axisRight, AxisScale, Axis} from 'd3-axis';
import {extent} from 'd3-array';
import {format} from 'd3-format';
import {scaleLinear} from 'd3-scale';
import {select, mouse, event as d3event} from 'd3-selection';
import {zoom as d3zoom, ZoomScale, ZoomTransform, D3ZoomEvent, zoomIdentity, ZoomBehavior} from 'd3-zoom';
import {drag as d3drag} from 'd3-drag';
import {quadtree, Quadtree, QuadtreeInternalNode, QuadtreeLeaf} from 'd3-quadtree';
import {circleSymbol, lineRenderer, ISymbol, ISymbolRenderer, ERenderMode, createRenderer} from './symbol';
import merge from './merge';
import {
  forEachLeaf,
  ellipseTester,
  isLeafNode,
  hasOverlap,
  getTreeSize,
  findByTester,
  getFirstLeaf,
  ABORT_TRAVERSAL,
  CONTINUE_TRAVERSAL,
  IBoundsPredicate,
  ITester
} from './quadtree';
import Lasso, {ILassoOptions} from './lasso';
import {cssprefix, DEBUG, debuglog} from './constants';
import showTooltip from './tooltip';
import {EventEmitter} from 'eventemitter3';
import {line} from 'd3-shape';
import AScatterplot, {
  fixScale,
  IScale,
  IScatterplotOptions,
  IScalesObject,
  IAccessor,
  EScaleAxes,
  IZoomOptions,
  IFormatOptions,
  ERenderReason,
  IMinMax,
  IWindow
} from './AScatterplot';

export interface IScalesObjectDualAxis extends IScalesObject {
  y2scale: IScale;
}

/**
 * scatterplot options
 */
export interface IScatterplotOptionsDualAxis<T> extends IScatterplotOptions<T> {

  /**
   * x2 accessor of the secondary data
   * default: d.x
   * @param d
   */
  x2?: IAccessor<T>;

  /**
   * y2 accessor of the secondary data
   * default: d.y
   * @param d
   */
  y2?: IAccessor<T>;

  /**
   * y axis label
   * default: x
   */
  y2label?: string;

  /**
   * d3 y2 scale
   * default: linear scale with a domain from 0...100
   */
  y2scale?: IScale;

  /**
   * instead of specifying the scale just the y limits
   */
  y2lim?: [number, number];

  /**
   * renderer used to render secondary dataset
   * default: steelblue circle
   */
  symbol2?: ISymbol<T>|string;
}

//normalized range the quadtree is defined
const DEFAULT_NORMALIZED_RANGE = [0, 100];

const customBaseProps = {
  margin: {
    right: 50
  }
}

/**
 * a class for rendering a double y-axis scatterplot in a canvas
 */
export default class DualAxisScatterplot<T> extends AScatterplot<T> {

  protected props: IScatterplotOptionsDualAxis<T> = {
    x: (d) => (<any>d).x,
    y: (d) => (<any>d).y,

    x2: (d) => (<any>d).x,
    y2: (d) => (<any>d).y,

    xlabel: 'x',
    ylabel: 'y',
    y2label: 'y2',

    xscale: <IScale>scaleLinear().domain([0, 100]),
    yscale: <IScale>scaleLinear().domain([0, 100]),
    y2scale: <IScale>scaleLinear().domain([0, 1000]),

    symbol: 'o',
    symbol2: 'o',
  };


  protected readonly normalized2pixel = {
    x: scaleLinear(),
    y: scaleLinear(),
    y2: scaleLinear()
  };

  private secondaryTree: Quadtree<T>;


  private readonly renderer: ISymbol<T>;
  private readonly secondaryRenderer: ISymbol<T>;

  constructor(data: T[], secondaryData: T[], root: HTMLElement, props?: IScatterplotOptionsDualAxis<T>) {
    super(data, root, customBaseProps);
    this.props = merge(this.props, props);
    this.props.xscale = fixScale(this.props.xscale, this.props.x, data, props ? props.xscale : null, props ? props.xlim : null);
    this.props.yscale = fixScale(this.props.yscale, this.props.y, data, props ? props.yscale : null, props ? props.ylim : null);
    this.props.y2scale = fixScale(this.props.y2scale, this.props.y2, secondaryData, props ? props.y2scale : null, props ? props.y2lim : null);

    this.renderer = createRenderer(this.props.symbol);
    this.secondaryRenderer = createRenderer(this.props.symbol2);

    // generate aspect ratio right normalized domain
    this.normalized2pixel.x.domain(DEFAULT_NORMALIZED_RANGE.map((d) => d*this.baseProps.aspectRatio));
    this.normalized2pixel.y.domain(DEFAULT_NORMALIZED_RANGE);
    this.normalized2pixel.y2.domain(DEFAULT_NORMALIZED_RANGE);

    this.setDataImpl(data);
    this.setSecondaryData(secondaryData);
    this.selectionTree = quadtree([], this.tree.x(), this.tree.y());

    this.initDOM(`
      <svg class="${cssprefix}-axis-right" style="width: ${this.baseProps.margin.left + 2}px; right: 0">
        <g transform="translate(0,${this.baseProps.margin.top})"><g>
      </svg>
      <div class="${cssprefix}-axis-right-label"  style="top: ${this.baseProps.margin.top + 2}px; bottom: ${this.baseProps.margin.bottom}px; right: 0"><div>${this.props.y2label}</div></div>
    `);

    this.canvasDataLayer = <HTMLCanvasElement>this.parent.children[0];
    this.canvasSelectionLayer = <HTMLCanvasElement>this.parent.children[1];
  }

  private setSecondaryData(secondaryData: T[]) {
    const domain2normalizedX = this.props.xscale.copy().range(this.normalized2pixel.x.domain());
    const domain2normalizedY2 = this.props.y2scale.copy().range(this.normalized2pixel.y2.domain());
    this.secondaryTree = quadtree(secondaryData, (d) => domain2normalizedX(this.props.x2(d)), (d) => domain2normalizedY2(this.props.y2(d)));
  }

  set secondaryData(secondaryData: T[]) {
    this.setSecondaryData(secondaryData);
    this.render(ERenderReason.DIRTY);
  }

  protected transformedScales(): IScalesObjectDualAxis {
    const xscale = this.rescale(EScaleAxes.x, this.props.xscale);
    const yscale = this.rescale(EScaleAxes.y, this.props.yscale);
    const y2scale = this.rescale(EScaleAxes.y, this.props.y2scale);
    return {xscale, yscale, y2scale};
  }

  protected transformedNormalized2PixelScales() {
    const n2pX = this.rescale(EScaleAxes.x, this.normalized2pixel.x);
    const n2pY = this.rescale(EScaleAxes.y, this.normalized2pixel.y);
    return {n2pX, n2pY};
  }

  /**
   * returns the total domain
   * @returns {{xMinMax: number[], yMinMax: number[]}}
   */
  get domain(): IWindow {
    return {
      xMinMax: <IMinMax>this.props.xscale.domain(),
      yMinMax: <IMinMax>this.props.yscale.domain(),
    };
  }

  protected render(reason = ERenderReason.DIRTY, transformDelta = {x: 0, y: 0, kx: 1, ky: 1}) {
    if (this.checkResize()) {
      //check resize
      return this.resized();
    }

    const c = this.canvasDataLayer,
      margin = this.baseProps.margin,
      bounds = {x0: margin.left, y0: margin.top, x1: c.clientWidth - margin.right, y1: c.clientHeight - margin.bottom},
      boundsWidth = bounds.x1 - bounds.x0,
      boundsHeight = bounds.y1 - bounds.y0;

    // emit render reason as string
    this.emit(DualAxisScatterplot.EVENT_RENDER, ERenderReason[reason], transformDelta);

    if (reason === ERenderReason.DIRTY) {
      this.props.xscale.range([0, boundsWidth]);
      this.props.yscale.range([boundsHeight, 0]);
      this.props.y2scale.range([boundsHeight, 0]);
      this.normalized2pixel.x.range(this.props.xscale.range());
      this.normalized2pixel.y.range(this.props.yscale.range());
      this.normalized2pixel.y2.range(this.props.y2scale.range());
    }

    //transform scale
    const {xscale, yscale, y2scale} = this.transformedScales();

    const {n2pX, n2pY} = this.transformedNormalized2PixelScales();
    const nx = (v) => n2pX.invert(v),
      ny = (v) => n2pY.invert(v);
    //inverted y scale
    const isNodeVisible = hasOverlap(nx(0), ny(boundsHeight), nx(boundsWidth), ny(0));

    function useAggregation(x0: number, y0: number, x1: number, y1: number) {
      x0 = n2pX(x0);
      y0 = n2pY(y0);
      x1 = n2pX(x1);
      y1 = n2pY(y1);
      const minSize = Math.max(Math.abs(x0 - x1), Math.abs(y0 - y1));
      return minSize < 5; //TODO tune depend on visual impact
    }

    const renderInfo = {
      zoomLevel: this.currentTransform.k
    };

    const renderCtx = (isSelection = false, isSecondary = false) => {
      const ctx = (isSelection ? this.canvasSelectionLayer : this.canvasDataLayer).getContext('2d');
      if(!isSecondary) {
        ctx.clearRect(0, 0, c.width, c.height);
      }
      ctx.save();
      ctx.rect(bounds.x0, bounds.y0, boundsWidth, boundsHeight);
      ctx.clip();
      const tree = isSelection ? this.selectionTree : isSecondary? this.secondaryTree : this.tree;
      const renderer = isSecondary? this.secondaryRenderer(ctx, ERenderMode.NORMAL, renderInfo) : this.renderer(ctx, isSelection ? ERenderMode.SELECTED : ERenderMode.NORMAL, renderInfo);
      const debug = !isSelection && DEBUG;
      ctx.translate(bounds.x0, bounds.y0);

      this.renderTree(ctx, tree, renderer, xscale, isSecondary? y2scale : yscale, isNodeVisible, useAggregation, isSecondary, debug);

      if (isSelection && this.hasExtras()) {
        ctx.save();
        this.baseProps.extras(ctx, xscale, yscale);
        ctx.restore();
      }

      ctx.restore();
      return ctx;
    };

    const renderSelection = !this.isSelectAble() && !this.hasExtras() ? () => undefined : () => {
        const ctx = renderCtx(true);
        this.lasso.render(ctx);
      };

    const renderAxes = this.renderAxes.bind(this, xscale, yscale, y2scale);
    const renderData = renderCtx.bind(this, false);
    const renderSecondaryData = renderCtx.bind(this, false, true);

    const clearAutoZoomRedraw = () => {
      if (this.zoomHandle >= 0) {
        //delete auto redraw timer
        clearTimeout(this.zoomHandle);
        this.zoomHandle = -1;
      }
    };

    debuglog(ERenderReason[reason]);
    //render logic
    switch (reason) {
      case ERenderReason.PERFORM_TRANSLATE:
        clearAutoZoomRedraw();
        this.transformData(c, bounds, boundsWidth, boundsHeight, transformDelta.x, transformDelta.y, transformDelta.kx, transformDelta.ky);
        renderSelection();
        renderAxes();
        //redraw everything after a while, i.e stopped moving
        this.zoomHandle = setTimeout(this.render.bind(this, ERenderReason.AFTER_TRANSLATE), this.baseProps.zoom.delay);
        break;
      case ERenderReason.SELECTION_CHANGED:
        renderSelection();
        break;
      case ERenderReason.AFTER_TRANSLATE:
        //just data needed after translation
        clearAutoZoomRedraw();
        renderData();
        renderSecondaryData();
        break;
      case ERenderReason.AFTER_SCALE_AND_TRANSLATE:
      case ERenderReason.AFTER_SCALE:
        //nothing current approach is to draw all
        break;
      //case ERenderReason.PERFORM_SCALE:
      //case ERenderReason.PERFORM_SCALE_AND_TRANSLATE:
      default:
        clearAutoZoomRedraw();
        renderData();
        renderSecondaryData();
        renderAxes();
        renderSelection();
    }
  }

  protected renderAxes(xscale: IScale, yscale: IScale, y2scale: IScale) {
    const left = axisLeft(yscale),
      bottom = axisBottom(xscale),
      right = axisRight(y2scale),
      $parent = select(this.parent);
    this.setAxisFormat(left, 'y');
    this.setAxisFormat(bottom, 'x');
    this.setAxisFormat(right, 'y');
    $parent.select(`.${cssprefix}-axis-left > g`).call(left);
    $parent.select(`.${cssprefix}-axis-bottom > g`).call(bottom);
    $parent.select(`.${cssprefix}-axis-right > g`).call(right);
  }

  private renderTree(ctx: CanvasRenderingContext2D, tree: Quadtree<T>, renderer: ISymbolRenderer<T>, xscale: IScale, yscale: IScale, isNodeVisible: IBoundsPredicate, useAggregation: IBoundsPredicate, isSecondary = false, debug = false) {
    let x: IAccessor<T>;
    let y: IAccessor<T>;

    if(isSecondary) {
      //({x2: x, y2: y} = this.props);
      const {x2, y2} = this.props;
      x = x2;
      y = y2;
    } else {
      ({x, y} = this.props);
    }

    //function debugNode(color:string, x0:number, y0:number, x1:number, y1:number) {
    //  ctx.closePath();
    //  ctx.fillStyle = 'steelblue';
    //  ctx.fill();
    //  ctx.fillStyle = color;
    //  x0 = xscale(x0);
    //  y0 = yscale(y0);
    //  x1 = xscale(x1);
    //  y1 = yscale(y1);
    //  ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x0 - x1), Math.abs(y0 - y1));
    //  ctx.beginPath();
    //
    //}
    //debug stats

    super.traverseTree(ctx, tree, renderer, xscale, yscale, isNodeVisible, useAggregation, debug, x, y);
  }
}
