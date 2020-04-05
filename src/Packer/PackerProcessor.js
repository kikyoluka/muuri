/**
 * Muuri Packer
 * Copyright (c) 2016-present, Niklas Rämö <inramo@gmail.com>
 * Released under the MIT license
 * https://github.com/haltu/muuri/blob/master/src/Packer/LICENSE.md
 */

function createPackerProcessor(isWorker = false) {
  var FILL_GAPS = 1;
  var HORIZONTAL = 2;
  var ALIGN_RIGHT = 4;
  var ALIGN_BOTTOM = 8;
  var ROUNDING = 16;

  var EPS = 0.001;
  var MIN_SLOT_SIZE = 0.5;

  function roundNumber(number) {
    return ((((number * 1000 + 0.5) << 0) / 10) << 0) / 100;
  }

  /**
   * @class
   */
  function PackerProcessor() {
    this.slotSizes = [];
    this.freeSlots = [];
    this.newSlots = [];
    this.rectItem = {};
    this.rectStore = [];
    this.rectId = 0;
    this.slotIndex = -1;
    this.slotData = { left: 0, top: 0, width: 0, height: 0 };
    this.sortRectsLeftTop = this.sortRectsLeftTop.bind(this);
    this.sortRectsTopLeft = this.sortRectsTopLeft.bind(this);
  }

  /**
   * Takes a layout object as an argument and computes positions (slots) for the
   * layout items. Also computes the final width and height of the layout. The
   * provided layout object's slots array is mutated as well as the width and
   * height properties.
   *
   * @param {Object} layout
   * @param {Number} layout.width
   *   - The start (current) width of the layout in pixels.
   * @param {Number} layout.height
   *   - The start (current) height of the layout in pixels.
   * @param {(Item[]|Number[])} layout.items
   *   - List of Muuri.Item instances or a list of item dimensions
   *     (e.g [ item1Width, item1Height, item2Width, item2Height, ... ]).
   * @param {(Array|Float32Array)} layout.slots
   *   - An Array/Float32Array instance which's length should equal to
   *     the amount of items times two. The position (width and height) of each
   *     item will be written into this array.
   * @param {Number} layout.settings
   *   - The layout's settings as bitmasks.
   * @returns {Object}
   */
  PackerProcessor.prototype.fillLayout = function (layout) {
    var items = layout.items;
    var slots = layout.slots;
    var settings = layout.settings || 0;
    var fillGaps = !!(settings & FILL_GAPS);
    var horizontal = !!(settings & HORIZONTAL);
    var alignRight = !!(settings & ALIGN_RIGHT);
    var alignBottom = !!(settings & ALIGN_BOTTOM);
    var rounding = !!(settings & ROUNDING);
    var isItemsPreProcessed = typeof items[0] === 'number';
    var i, bump, item, slotWidth, slotHeight, slot;

    // No need to go further if items do not exist.
    if (!items.length) return layout;

    // Compute slots for the items.
    bump = isItemsPreProcessed ? 2 : 1;
    for (i = 0; i < items.length; i += bump) {
      // If items are pre-processed it means that items array contains only
      // the raw dimensions of the items. Otherwise we assume it is an array
      // of normal Muuri items.
      if (isItemsPreProcessed) {
        slotWidth = items[i];
        slotHeight = items[i + 1];
      } else {
        item = items[i];
        slotWidth = item._width + item._marginLeft + item._marginRight;
        slotHeight = item._height + item._marginTop + item._marginBottom;
      }

      // If rounding is enabled let's round the item's width and height to
      // make the layout algorithm a bit more stable. This has a performance
      // cost so don't use this if not necessary.
      if (rounding) {
        slotWidth = roundNumber(slotWidth);
        slotHeight = roundNumber(slotHeight);
      }

      // Get slot data.
      slot = this.computeNextSlot(layout, slotWidth, slotHeight, fillGaps, horizontal);

      // Update layout width/height.
      if (horizontal) {
        layout.width = Math.max(layout.width, slot.left + slot.width);
      } else {
        layout.height = Math.max(layout.height, slot.top + slot.height);
      }

      // Add item slot data to layout slots.
      slots[++this.slotIndex] = slot.left;
      slots[++this.slotIndex] = slot.top;

      // Store the size too (for later usage) if needed.
      if (alignRight || alignBottom) {
        this.slotSizes.push(slot.width, slot.height);
      }
    }

    // If the alignment is set to right we need to adjust the results.
    if (alignRight) {
      for (i = 0; i < slots.length; i += 2) {
        slots[i] = layout.width - (slots[i] + this.slotSizes[i]);
      }
    }

    // If the alignment is set to bottom we need to adjust the results.
    if (alignBottom) {
      for (i = 1; i < slots.length; i += 2) {
        slots[i] = layout.height - (slots[i] + this.slotSizes[i]);
      }
    }

    // Reset stuff.
    this.slotSizes.length = 0;
    this.freeSlots.length = 0;
    this.newSlots.length = 0;
    this.rectId = 0;
    this.slotIndex = -1;

    return layout;
  };

  /**
   * Calculate next slot in the layout. Returns a slot object with position and
   * dimensions data.
   *
   * @param {Object} layout
   * @param {Number} slotWidth
   * @param {Number} slotHeight
   * @param {Boolean} fillGaps
   * @param {Boolean} horizontal
   * @returns {Object}
   */
  PackerProcessor.prototype.computeNextSlot = function (
    layout,
    slotWidth,
    slotHeight,
    fillGaps,
    horizontal
  ) {
    var slot = this.slotData;
    var freeSlots = this.freeSlots;
    var newSlots = this.newSlots;
    var ignoreCurrentSlots = false;
    var rect;
    var rectId;
    var potentialSlots;
    var i;
    var j;

    // Reset new slots.
    newSlots.length = 0;

    // Set item slot initial data.
    slot.left = null;
    slot.top = null;
    slot.width = slotWidth;
    slot.height = slotHeight;

    // Try to find a slot for the item.
    for (i = 0; i < freeSlots.length; i++) {
      rectId = freeSlots[i];
      if (!rectId) continue;
      rect = this.getRect(rectId);
      if (slot.width <= rect.width + EPS && slot.height <= rect.height + EPS) {
        slot.left = rect.left;
        slot.top = rect.top;
        break;
      }
    }

    // If no slot was found for the item position the item in to the bottom left
    // (in vertical mode) or top right (in horizontal mode) of the grid.
    if (slot.left === null) {
      if (horizontal) {
        slot.left = layout.width;
        slot.top = 0;
      } else {
        slot.left = 0;
        slot.top = layout.height;
      }

      // If gaps don't need filling do not add any current slots to the new
      // slots array.
      if (!fillGaps) {
        ignoreCurrentSlots = true;
      }
    }

    // In vertical mode, if the item's bottom overlaps the grid's bottom. This
    // is where we create the all the completely new slots if necessary.
    if (!horizontal && slot.top + slot.height > layout.height + EPS) {
      // If item is not aligned to the left edge, create a new slot.
      if (slot.left > MIN_SLOT_SIZE) {
        newSlots.push(this.addRect(0, layout.height, slot.left, Infinity));
      }

      // If item is not aligned to the right edge, create a new slot.
      if (slot.left + slot.width < layout.width - MIN_SLOT_SIZE) {
        newSlots.push(
          this.addRect(
            slot.left + slot.width,
            layout.height,
            layout.width - slot.left - slot.width,
            Infinity
          )
        );
      }

      // Update grid height.
      layout.height = slot.top + slot.height;
    }

    // In horizontal mode, if the item's right overlaps the grid's right edge.
    // This is where we create the all the completely new slots if necessary.
    if (horizontal && slot.left + slot.width > layout.width + EPS) {
      // If item is not aligned to the top, create a new slot.
      if (slot.top > MIN_SLOT_SIZE) {
        newSlots.push(this.addRect(layout.width, 0, Infinity, slot.top));
      }

      // If item is not aligned to the bottom, create a new slot.
      if (slot.top + slot.height < layout.height - MIN_SLOT_SIZE) {
        newSlots.push(
          this.addRect(
            layout.width,
            slot.top + slot.height,
            Infinity,
            layout.height - slot.top - slot.height
          )
        );
      }

      // Update grid width.
      layout.width = slot.left + slot.width;
    }

    // Clean up the current slots making sure there are no old slots that
    // overlap with the item. If an old slot overlaps with the item, split it
    // into smaller slots if necessary.
    if (!ignoreCurrentSlots) {
      if (fillGaps) i = 0;
      for (; i < freeSlots.length; i++) {
        rectId = freeSlots[i];
        if (!rectId) continue;
        rect = this.getRect(rectId);
        potentialSlots = this.splitSlot(rect, slot);
        for (j = 0; j < potentialSlots.length; j++) {
          rectId = potentialSlots[j];
          rect = this.getRect(rectId);
          // Make sure that the slot is within the boundaries of the grid. This
          // routine is critical to the algorithm as it makes sure that there
          // are no leftover slots with infinite height. It's also essential
          // that we don't compare values absolutely to each other but leave a
          // little headroom (EPSILON) to get rid of false positives (especially
          // using relative values in DOM has a tendency to cause a little
          // variation in the dimensions where they should be equal in reality).
          if (
            horizontal ? rect.left + EPS < layout.width - EPS : rect.top + EPS < layout.height - EPS
          ) {
            newSlots.push(rectId);
          }
        }
      }
    }

    // Sanitize new slots.
    if (newSlots.length > 1) {
      this.purgeSlots(newSlots).sort(horizontal ? this.sortRectsLeftTop : this.sortRectsTopLeft);
    }

    // Free/new slots switcheroo!
    this.freeSlots = newSlots;
    this.newSlots = freeSlots;

    return slot;
  };

  /**
   * Add a new rectangle to the rectangle store. Returns the id of the new
   * rectangle.
   *
   * @param {Number} left
   * @param {Number} top
   * @param {Number} width
   * @param {Number} height
   * @returns {Number}
   */
  PackerProcessor.prototype.addRect = function (left, top, width, height) {
    var rectId = ++this.rectId;
    var rectStore = this.rectStore;

    rectStore[rectId] = left || 0;
    rectStore[++this.rectId] = top || 0;
    rectStore[++this.rectId] = width || 0;
    rectStore[++this.rectId] = height || 0;

    return rectId;
  };

  /**
   * Get rectangle data from the rectangle store by id. Optionally you can
   * provide a target object where the rectangle data will be written in. By
   * default an internal object is reused as a target object.
   *
   * @param {Number} id
   * @param {Object} [target]
   * @returns {Object}
   */
  PackerProcessor.prototype.getRect = function (id, target) {
    var rectItem = target ? target : this.rectItem;
    var rectStore = this.rectStore;

    rectItem.left = rectStore[id] || 0;
    rectItem.top = rectStore[++id] || 0;
    rectItem.width = rectStore[++id] || 0;
    rectItem.height = rectStore[++id] || 0;

    return rectItem;
  };

  /**
   * Punch a hole into a slot and split the remaining area into smaller
   * slots (4 at max).
   * @param {Object} slot
   * @param {Object} hole
   * @returns {Number[]}
   */
  PackerProcessor.prototype.splitSlot = (function () {
    var results = [];
    var width = 0;
    var height = 0;
    return function (slot, hole) {
      // Reset old results.
      results.length = 0;

      // If the slot does not overlap with the hole add slot to the return data
      // as is. Note that in this case we are eager to keep the slot as is if
      // possible so we use the EPSILON in favour of that logic.
      if (
        slot.left + slot.width <= hole.left + EPS ||
        hole.left + hole.width <= slot.left + EPS ||
        slot.top + slot.height <= hole.top + EPS ||
        hole.top + hole.height <= slot.top + EPS
      ) {
        results.push(this.addRect(slot.left, slot.top, slot.width, slot.height));
        return results;
      }

      // Left split.
      width = hole.left - slot.left;
      if (width >= MIN_SLOT_SIZE) {
        results.push(this.addRect(slot.left, slot.top, width, slot.height));
      }

      // Right split.
      width = slot.left + slot.width - (hole.left + hole.width);
      if (width >= MIN_SLOT_SIZE) {
        results.push(this.addRect(hole.left + hole.width, slot.top, width, slot.height));
      }

      // Top split.
      height = hole.top - slot.top;
      if (height >= MIN_SLOT_SIZE) {
        results.push(this.addRect(slot.left, slot.top, slot.width, height));
      }

      // Bottom split.
      height = slot.top + slot.height - (hole.top + hole.height);
      if (height >= MIN_SLOT_SIZE) {
        results.push(this.addRect(slot.left, hole.top + hole.height, slot.width, height));
      }

      return results;
    };
  })();

  /**
   * Check if a rectangle is fully within another rectangle.
   *
   * @param {Object} a
   * @param {Object} b
   * @returns {Boolean}
   */
  PackerProcessor.prototype.isRectAWithinRectB = function (a, b) {
    return (
      a.left + EPS >= b.left &&
      a.top + EPS >= b.top &&
      a.left + a.width - EPS <= b.left + b.width &&
      a.top + a.height - EPS <= b.top + b.height
    );
  };

  /**
   * Loops through an array of rectangle ids and resets all that are fully
   * within another rectangle in the array. Resetting in this case means that
   * the rectangle id value is replaced with zero.
   *
   * @param {Number[]} rectIds
   * @returns {Number[]}
   */
  PackerProcessor.prototype.purgeSlots = (function () {
    var rectA = {};
    var rectB = {};
    return function (rectIds) {
      var i = rectIds.length;
      var j;

      while (i--) {
        j = rectIds.length;
        if (!rectIds[i]) continue;
        this.getRect(rectIds[i], rectA);
        while (j--) {
          if (!rectIds[j] || i === j) continue;
          this.getRect(rectIds[j], rectB);
          if (this.isRectAWithinRectB(rectA, rectB)) {
            rectIds[i] = 0;
            break;
          }
        }
      }

      return rectIds;
    };
  })();

  /**
   * Sort rectangles with top-left gravity.
   *
   * @param {Number} aId
   * @param {Number} bId
   * @returns {Number}
   */
  PackerProcessor.prototype.sortRectsTopLeft = (function () {
    var rectA = {};
    var rectB = {};
    return function (aId, bId) {
      this.getRect(aId, rectA);
      this.getRect(bId, rectB);

      return rectA.top < rectB.top && rectA.top + EPS < rectB.top
        ? -1
        : rectA.top > rectB.top && rectA.top - EPS > rectB.top
        ? 1
        : rectA.left < rectB.left && rectA.left + EPS < rectB.left
        ? -1
        : rectA.left > rectB.left && rectA.left - EPS > rectB.left
        ? 1
        : 0;
    };
  })();

  /**
   * Sort rectangles with left-top gravity.
   *
   * @param {Number} aId
   * @param {Number} bId
   * @returns {Number}
   */
  PackerProcessor.prototype.sortRectsLeftTop = (function () {
    var rectA = {};
    var rectB = {};
    return function (aId, bId) {
      this.getRect(aId, rectA);
      this.getRect(bId, rectB);
      return rectA.left < rectB.left && rectA.left + EPS < rectB.left
        ? -1
        : rectA.left > rectB.left && rectA.left - EPS < rectB.left
        ? 1
        : rectA.top < rectB.top && rectA.top + EPS < rectB.top
        ? -1
        : rectA.top > rectB.top && rectA.top - EPS > rectB.top
        ? 1
        : 0;
    };
  })();

  if (isWorker) {
    var PACKET_INDEX_WIDTH = 1;
    var PACKET_INDEX_HEIGHT = 2;
    var PACKET_INDEX_OPTIONS = 3;
    var PACKET_HEADER_SLOTS = 4;
    var processor = new PackerProcessor();

    self.onmessage = function (msg) {
      var data = new Float32Array(msg.data);
      var items = data.subarray(PACKET_HEADER_SLOTS, data.length);
      var slots = new Float32Array(items.length);
      var layout = {
        items: items,
        slots: slots,
        width: data[PACKET_INDEX_WIDTH],
        height: data[PACKET_INDEX_HEIGHT],
        settings: data[PACKET_INDEX_OPTIONS],
      };

      // Fill the layout (width / height / slots).
      processor.fillLayout(layout);

      // Copy layout data to the return data.
      data[PACKET_INDEX_WIDTH] = layout.width;
      data[PACKET_INDEX_HEIGHT] = layout.height;
      data.set(layout.slots, PACKET_HEADER_SLOTS);

      // Send layout back to the main thread.
      postMessage(data.buffer, [data.buffer]);
    };
  }

  return PackerProcessor;
}

var PackerProcessor = createPackerProcessor();

export default PackerProcessor;

export function createWorkers(amount, onmessage) {
  var workers = [];
  var blobUrl = URL.createObjectURL(
    new Blob(['(' + createPackerProcessor.toString() + ')(true)'], {
      type: 'application/javascript',
    })
  );

  for (var i = 0, worker; i < amount; i++) {
    worker = new Worker(blobUrl);
    if (onmessage) worker.onmessage = onmessage;
    workers.push(worker);
  }

  URL.revokeObjectURL(blobUrl);
  return workers;
}

export function isWorkerSupported() {
  return !!(window.Worker && window.URL && window.Blob);
}
