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
export interface IScatterplotOptions<T> {
  /**
   * margin for the scatterplot area
   * default (left=40, top=10, right=10, bottom=20)
   */
  margin?: {
    left?: number;
    top?: number;
    right?: number;
    bottom?: number;
  };

  zoom?: IZoomOptions;

  format?: IFormatOptions;

  /**
   * x accessor of the data
   * default: d.x
   * @param d
   */
  x?: IAccessor<T>;

  /**
   * y accessor of the data
   * default: d.y
   * @param d
   */
  y?: IAccessor<T>;

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
   * x axis label
   * default: x
   */
  xlabel?: string;

  /**
   * y axis label
   * default: x
   */
  ylabel?: string;

  /**
   * y axis label
   * default: x
   */
  y2label?: string;

  /**
   * d3 x scale
   * default: linear scale with a domain from 0...100
   */
  xscale?: IScale;

  /**
   * instead of specifying the scale just the x limits
   */
  xlim?: [number, number];

  /**
   * d3 y scale
   * default: linear scale with a domain from 0...100
   */
  yscale?: IScale;

  /**
   * d3 y2 scale
   * default: linear scale with a domain from 0...100
   */
  y2scale?: IScale;

  /**
   * instead of specifying the scale just the y limits
   */
  ylim?: [number, number];

  /**
   * instead of specifying the scale just the y limits
   */
  y2lim?: [number, number];

  /**
   * symbol used to render a data point of the primary dataset
   * default: steelblue circle
   */
  symbol?: ISymbol<T>|string;

  /**
   * renderer used to render secondary dataset
   * default: steelblue circle
   */
  symbol2?: ISymbol<T>|string;

  /**
   * the radius in pixel in which a mouse click will be searched
   * default: 10
   */
  clickRadius?: number;

  /**
   * delay before a tooltip will be shown after a mouse was moved
   * default: 500
   */
  tooltipDelay?: number;

  /**
   * shows the tooltip
   * default: simple popup similar to bootstrap
   * if `null` or `false` tooltips are disabled
   * @param parent the scatterplot html element
   * @param items items to show, empty to hide tooltip
   * @param x the x position relative to the plot
   * @param y the y position relative to the plot
   */
  showTooltip?(parent: HTMLElement, items: T[], x: number, y: number);

  /**
   * determines whether the given mouse is a selection or panning event, if `null` or `false` selection is disabled
   * default: event.ctrlKey || event.altKey
   *
   */
  isSelectEvent?(event: MouseEvent): boolean; //=> event.ctrlKey || event.altKey

  /**
   * lasso options
   */
  lasso?: ILassoOptions & {
    /**
     * lasso update frequency to improve performance
     */
    interval?: number
  };

  /**
   * additional render elements, e.g. lines
   * @param ctx
   * @param xscale
   * @param yscale
   */
  extras?(ctx: CanvasRenderingContext2D, xscale: IScale, yscale: IScale);

  /**
   * optional hint for the scatterplot in which aspect ratio it will be rendered. This is useful for improving the selection and interaction in non 1:1 aspect ratios
   */
  aspectRatio?: number;
}

//normalized range the quadtree is defined
const DEFAULT_NORMALIZED_RANGE = [0, 100];

/**
 * a class for rendering a double y-axis scatterplot in a canvas
 */
export default class DualAxisScatterplot<T> extends AScatterplot<T> {

  private props: IScatterplotOptions<T> = {
    margin: {
      left: 48,
      top: 10,
      bottom: 32,
      right: 50
    },
    clickRadius: 10,

    zoom: {
      scale: EScaleAxes.xy,
      delay: 300,
      scaleExtent: [1, +Infinity],
      window: null,
      scaleTo: 1,
      translateBy: [0, 0],
    },

    format: {},

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

    tooltipDelay: 500,

    showTooltip,

    isSelectEvent: (event: MouseEvent) => event.ctrlKey || event.altKey,

    lasso: {
      interval: 100
    },

    extras: null,

    aspectRatio: 1
  };


  private readonly normalized2pixel = {
    x: scaleLinear(),
    y: scaleLinear(),
    y2: scaleLinear()
  };

  private secondaryTree: Quadtree<T>;


  private readonly renderer: ISymbol<T>;
  private readonly secondaryRenderer: ISymbol<T>;

  constructor(data: T[], secondaryData: T[], root: HTMLElement, props?: IScatterplotOptions<T>) {
    super(data, root);
    this.props = merge(this.props, props);
    this.props.xscale = fixScale(this.props.xscale, this.props.x, data, props ? props.xscale : null, props ? props.xlim : null);
    this.props.yscale = fixScale(this.props.yscale, this.props.y, data, props ? props.yscale : null, props ? props.ylim : null);
    this.props.y2scale = fixScale(this.props.y2scale, this.props.y2, secondaryData, props ? props.y2scale : null, props ? props.y2lim : null);

    this.renderer = createRenderer(this.props.symbol);
    this.secondaryRenderer = createRenderer(this.props.symbol2);

    // generate aspect ratio right normalized domain
    this.normalized2pixel.x.domain(DEFAULT_NORMALIZED_RANGE.map((d) => d*this.props.aspectRatio));
    this.normalized2pixel.y.domain(DEFAULT_NORMALIZED_RANGE);
    this.normalized2pixel.y2.domain(DEFAULT_NORMALIZED_RANGE);

    this.setDataImpl(data);
    this.setSecondaryData(secondaryData);
    this.selectionTree = quadtree([], this.tree.x(), this.tree.y());

    root.appendChild(this.parent);
    //init dom
    this.parent.innerHTML = `
      <canvas class="${cssprefix}-data-layer"></canvas>
      <canvas class="${cssprefix}-selection-layer" ${!this.isSelectAble() && !this.hasExtras() ? 'style="visibility: hidden"' : ''}></canvas>
      <svg class="${cssprefix}-axis-left" style="width: ${this.props.margin.left + 2}px;">
        <g transform="translate(${this.props.margin.left},${this.props.margin.top})"><g>
      </svg>
      <div class="${cssprefix}-axis-left-label"  style="top: ${this.props.margin.top + 2}px; bottom: ${this.props.margin.bottom}px"><div>${this.props.ylabel}</div></div>
      <svg class="${cssprefix}-axis-right" style="width: ${this.props.margin.left + 2}px; right: 0">
        <g transform="translate(0,${this.props.margin.top})"><g>
      </svg>
      <div class="${cssprefix}-axis-right-label"  style="top: ${this.props.margin.top + 2}px; bottom: ${this.props.margin.bottom}px; right: 0"><div>${this.props.y2label}</div></div>
      <svg class="${cssprefix}-axis-bottom" style="height: ${this.props.margin.bottom}px;">
        <g transform="translate(${this.props.margin.left},0)"><g>
      </svg>
      <div class="${cssprefix}-axis-bottom-label" style="left: ${this.props.margin.left + 2}px; right: ${this.props.margin.right}px"><div>${this.props.xlabel}</div></div>
    `;
    this.parent.classList.add(cssprefix);

    this.canvasDataLayer = <HTMLCanvasElement>this.parent.children[0];
    this.canvasSelectionLayer = <HTMLCanvasElement>this.parent.children[1];

    //need to use d3 for d3.mouse to work
    const $parent = select(this.parent);

    if (this.isSelectAble()) {
      const drag = d3drag()
        .on('start', this.onDragStart.bind(this))
        .on('drag', this.onDrag.bind(this))
        .on('end', this.onDragEnd.bind(this))
        .filter(() => d3event.button === 0 && this.props.isSelectEvent(<MouseEvent>d3event));
      $parent.call(drag)
        .on('click', () => this.onClick(d3event));
    }
    if (this.hasTooltips()) {
      $parent.on('mouseleave', () => this.onMouseLeave(d3event))
        .on('mousemove', () => this.onMouseMove(d3event));
    }
  }

  get data() {
    return this.tree.data();
  }

  private setDataImpl(data: T[]) {
    //generate a quad tree out of the data
    //work on a normalized dimension within the quadtree to
    // * be independent of the current pixel size
    // * but still consider the mapping function (linear, pow, log) from the data domain
    const domain2normalizedX = this.props.xscale.copy().range(this.normalized2pixel.x.domain());
    const domain2normalizedY = this.props.yscale.copy().range(this.normalized2pixel.y.domain());
    this.tree = quadtree(data, (d) => domain2normalizedX(this.props.x(d)), (d) => domain2normalizedY(this.props.y(d)));
  }

  private setSecondaryData(secondaryData: T[]) {
    const domain2normalizedX = this.props.xscale.copy().range(this.normalized2pixel.x.domain());
    const domain2normalizedY2 = this.props.y2scale.copy().range(this.normalized2pixel.y2.domain());
    this.secondaryTree = quadtree(secondaryData, (d) => domain2normalizedX(this.props.x2(d)), (d) => domain2normalizedY2(this.props.y2(d)));
  }

  set data(data: T[]) {
    this.setDataImpl(data);
    this.selectionTree = quadtree([], this.tree.x(), this.tree.y());
    this.render(ERenderReason.DIRTY);
  }

  set secondaryData(secondaryData: T[]) {
    this.setSecondaryData(secondaryData);
    this.render(ERenderReason.DIRTY);
  }


  resized() {
    this.render(ERenderReason.DIRTY);
  }

  protected transformedScales(): IScalesObjectDualAxis {
    const xscale = this.rescale(EScaleAxes.x, this.props.xscale);
    const yscale = this.rescale(EScaleAxes.y, this.props.yscale);
    const y2scale = this.rescale(EScaleAxes.y, this.props.y2scale);
    return {xscale, yscale, y2scale};
  }

  private getMouseNormalizedPos(canvasPixelPox = this.mousePosAtCanvas()) {
    const {n2pX, n2pY} = this.transformedNormalized2PixelScales();

    function range(range: number[]) {
      return Math.abs(range[1] - range[0]);
    }

    const computeClickRadius = () => {
      //compute the data domain radius based on xscale and the scaling factor
      const view = this.props.clickRadius;
      const transform = this.currentTransform;
      const scale = this.props.zoom.scale;
      const kX = (scale === EScaleAxes.x || scale === EScaleAxes.xy) ? transform.k : 1;
      const kY = (scale === EScaleAxes.y || scale === EScaleAxes.xy) ? transform.k : 1;
      const viewSizeX = kX * range(this.normalized2pixel.x.range());
      const viewSizeY = kY * range(this.normalized2pixel.y.range());
      //tranform from view to data without translation
      const normalizedRangeX = range(this.normalized2pixel.x.domain());
      const normalizedRangeY = range(this.normalized2pixel.y.domain());
      const normalizedX = view / viewSizeX * normalizedRangeX;
      const normalizedY = view / viewSizeY * normalizedRangeY;
      //const view = this.props.xscale(base)*transform.k - this.props.xscale.range()[0]; //skip translation
      //debuglog(view, viewSize, transform.k, normalizedSize, normalized);
      return [normalizedX, normalizedY];
    };

    const [clickRadiusX, clickRadiusY] = computeClickRadius();
    return {x: n2pX.invert(canvasPixelPox[0]), y: n2pY.invert(canvasPixelPox[1]), clickRadiusX, clickRadiusY};
  }

  private transformedNormalized2PixelScales() {
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

  private onDragStart() {
    this.lasso.start(d3event.x, d3event.y);
    if (!this.clearSelection()) {
      this.render(ERenderReason.SELECTION_CHANGED);
    }
  }

  private onDrag() {
    if (this.dragHandle < 0) {
      this.dragHandle = setInterval(this.updateDrag.bind(this), this.props.lasso.interval);
    }
    this.lasso.setCurrent(d3event.x, d3event.y);
    this.render(ERenderReason.SELECTION_CHANGED);
  }

  private updateDrag() {
    if (this.lasso.pushCurrent()) {
      this.retestLasso();
    }
  }

  private retestLasso() {
    const {n2pX, n2pY} = this.transformedNormalized2PixelScales();
    // shift by the margin since the scales doesn't include them for better scaling experience
    const tester = this.lasso.tester(n2pX.invert.bind(n2pX), n2pY.invert.bind(n2pY), -this.props.margin.left, -this.props.margin.top);
    return tester && this.selectWithTester(tester);
  }

  private onDragEnd() {
    clearInterval(this.dragHandle);
    this.dragHandle = -1;

    this.lasso.end(d3event.x, d3event.y);
    if (!this.retestLasso()) {
      this.render(ERenderReason.SELECTION_CHANGED);
    }
    this.lasso.clear();
  }

  private onClick(event: MouseEvent) {
    if (event.button > 0) {
      //right button or something like that = reset
      this.selection = [];
      return;
    }
    const {x, y, clickRadiusX, clickRadiusY} = this.getMouseNormalizedPos();
    //find closest data item
    const tester = ellipseTester(x, y, clickRadiusX, clickRadiusY);
    this.selectWithTester(tester);
  }

  private showTooltip(canvasPos: [number, number]) {
    //highlight selected item
    const {x, y, clickRadiusX, clickRadiusY} = this.getMouseNormalizedPos(canvasPos);
    const tester = ellipseTester(x, y, clickRadiusX, clickRadiusY);
    const items = findByTester(this.tree, tester);
    // canvas pos doesn't include the margin
    this.props.showTooltip(this.parent, items, canvasPos[0] +  this.props.margin.left, canvasPos[1] + this.props.margin.top);
    this.showTooltipHandle = -1;
  }

  private onMouseMove(event: MouseEvent) {
    if (this.showTooltipHandle >= 0) {
      this.onMouseLeave(event);
    }
    const pos = this.mousePosAtCanvas();
    //TODO find a more efficient way or optimize the timing
    this.showTooltipHandle = setTimeout(this.showTooltip.bind(this, pos), this.props.tooltipDelay);
  }

  private onMouseLeave(event: MouseEvent) {
    clearTimeout(this.showTooltipHandle);
    this.showTooltipHandle = -1;
    this.props.showTooltip(this.parent, [], 0, 0);
  }

  protected render(reason = ERenderReason.DIRTY, transformDelta = {x: 0, y: 0, kx: 1, ky: 1}) {
    if (this.checkResize()) {
      //check resize
      return this.resized();
    }

    const c = this.canvasDataLayer,
      margin = this.props.margin,
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
        this.props.extras(ctx, xscale, yscale);
        ctx.restore();
      }

      ctx.restore();
      return ctx;
    };

    const renderSelection = !this.isSelectAble() && !this.hasExtras() ? () => undefined : () => {
        const ctx = renderCtx(true);
        this.lasso.render(ctx);
      };

    const transformData = (x: number, y: number, kx: number, ky: number) => {
      //idea copy the data layer to selection layer in a transformed way and swap
      const ctx = this.canvasSelectionLayer.getContext('2d');
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.save();
      ctx.rect(bounds.x0, bounds.y0, boundsWidth, boundsHeight);
      ctx.clip();

      //ctx.translate(bounds.x0, bounds.y0+bounds_height); //move to visible area
      //debuglog(x,y,k, bounds.x0, bounds.y0, n2pX(0), n2pY(100), this.currentTransform.x, this.currentTransform.y);
      //ctx.scale(k,k);
      //ctx.translate(0, -bounds_height); //move to visible area
      ctx.translate(x, y);
      //copy just the visible area
      //canvas, clip area, target area
      //see http://www.w3schools.com/tags/canvas_drawimage.asp
      ctx.drawImage(this.canvasDataLayer, bounds.x0, bounds.y0, boundsWidth, boundsHeight, bounds.x0, bounds.y0, boundsWidth * kx, boundsHeight * ky);
      ctx.restore();

      //swap and update class names
      [this.canvasDataLayer, this.canvasSelectionLayer] = [this.canvasSelectionLayer, this.canvasDataLayer];
      this.canvasDataLayer.className = `${cssprefix}-data-layer`;
      this.canvasSelectionLayer.className = `${cssprefix}-selection-layer`;
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
        transformData(transformDelta.x, transformDelta.y, transformDelta.kx, transformDelta.ky);
        renderSelection();
        renderAxes();
        //redraw everything after a while, i.e stopped moving
        this.zoomHandle = setTimeout(this.render.bind(this, ERenderReason.AFTER_TRANSLATE), this.props.zoom.delay);
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
    const setFormat = (axis: Axis<number>, key: string) => {
      const p = this.props.format[key];
      if (p == null) {
        return;
      }
      axis.tickFormat(typeof p === 'string' ? format(p) : p);
    };
    setFormat(left, 'y');
    setFormat(bottom, 'x');
    $parent.select('svg > g').call(left);
    $parent.select('svg:last-of-type > g').call(bottom);
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
    let rendered = 0, aggregated = 0, hidden = 0;

    function visitTree(node: QuadtreeInternalNode<T> | QuadtreeLeaf<T>, x0: number, y0: number, x1: number, y1: number) {
      if (!isNodeVisible(x0, y0, x1, y1)) {
        hidden += debug ? getTreeSize(node) : 0;
        return ABORT_TRAVERSAL;
      }
      if (useAggregation(x0, y0, x1, y1)) {
        const d = getFirstLeaf(node);
        //debuglog('aggregate', getTreeSize(node));
        rendered++;
        aggregated += debug ? (getTreeSize(node) - 1) : 0;
        renderer.render(xscale(x(d)), yscale(y(d)), d);
        return ABORT_TRAVERSAL;
      }
      if (isLeafNode(node)) { //is a leaf
        rendered += forEachLeaf(<QuadtreeLeaf<T>>node, (d) => renderer.render(xscale(x(d)), yscale(y(d)), d));
      }
      return CONTINUE_TRAVERSAL;
    }

    ctx.save();

    tree.visit(visitTree);
    renderer.done();

    if (debug) {
      debuglog('rendered', rendered, 'aggregated', aggregated, 'hidden', hidden, 'total', this.tree.size());
    }

    //a dummy path to clear the 'to draw' state
    ctx.beginPath();
    ctx.closePath();

    ctx.restore();
  }
}
