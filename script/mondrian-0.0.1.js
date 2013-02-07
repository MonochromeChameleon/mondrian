/*globals jQuery, CSSParser, jscsspDeclaration, jscsspStyleRule */
/*jslint browser: true */

/**
 * Still to be done:
 * - Not-found named grid areas
 * - Named grid lines
 * - Row/column span on grid-area definitions
 * - Auto flow
 * - Repeat
 * - width / height: [min-/max-]content, minmax, auto = minmax(min-content, max-content)
 * - Probably more
 */

(function ($) {
    "use strict";
    var debug, models, context, gridRules, cssHandler;

    $.fn.extend({
        firstMatchingIndex: function (array, callback) {
            var ix;
            $.each(array, function (ii, obj) {
                if (callback(obj)) {
                    ix = ii;
                }
                return !ix; // break out on finding the appropriate index
            });
            return ix;
        }
    });

    $.extend({
        throttledResize: function (delay, callback) {
            var timeout;
            window.onresize = function () {
                if (timeout) {
                    clearTimeout(timeout);
                }
                timeout = setTimeout(callback, delay);
            };
        }
    });

    debug = (function () {
        // Uses query-string inspection either on the browser, or the css file path definition, to switch to debug
        // rendering.

        var debugRegex = /mondrian-(debug|labels|outline)/,
            labelsRegex = /mondrian-labels/,
            outlineRegex = /mondrian-outline/,
            noDebugRegex = /mondrian-no-debug/,

            queryString = window.location.search;

        return {
            on: false,
            labels: false,
            content: false,
            configure: function (cssFilePath) {
                // Allow override in the browser of a debug-enabled css file path.
                if ((window.location.search.match(noDebugRegex))) {
                    return;
                }

                if (queryString.match(debugRegex) || cssFilePath.match(debugRegex)) {
                    this.on = true;
                    this.labels = queryString.match(labelsRegex) || cssFilePath.match(labelsRegex);
                    this.content = queryString.match(outlineRegex) || cssFilePath.match(outlineRegex);
                }
            }
        };
    }());

    models = (function () {

        function grid(selector) {
            return {
                rows: [],
                columns: [],
                applyRules: function () {
                    cssHandler.applyRules(selector);
                }
            };
        }

        function rowCol(isRow) {
            return function (definition) {
                var type,
                    heightOrWidth,
                    ret,
                    size = definition.size,
                    name = definition.name;

                if (size === "auto") {
                    type = "auto";
                } else if (size.match(/(\d+)px/)) {
                    type = "px";
                    heightOrWidth = size.match(/(\d+)px/)[1];
                } else if (size.match(/(\d*\.?\d+)fr/)) {
                    type = "fr";
                    heightOrWidth = size.match(/(\d*\.?\d+)fr/)[1];
                } else if (size.match(/(\d*\.?\d+)%/)) {
                    type = "%";
                    heightOrWidth = size.match(/(\d*\.?\d+)%/)[1];
                }
                heightOrWidth = Number(heightOrWidth);

                ret = {
                    type: type,
                    value: heightOrWidth,
                    name: name,
                    definePercent: function (gridSize) {
                        if (this.type === "%") {
                            this[isRow ? "height" : "width"] = (this.value * gridSize / 100);
                        }
                    },

                    defineFraction: function (frSizeUnit) {
                        if (this.type === "fr") {
                            this[isRow ? "height" : "width"] = (this.value * frSizeUnit);
                        }
                    }
                };

                ret[isRow ? "height" : "width"] = heightOrWidth;
                return ret;
            };
        }

        return {
            grid: grid,
            row: rowCol(true),
            column: rowCol(false),
            gridComponent: function (object) {
                return {
                    object: object,
                    rowSpan: 1,
                    columnSpan: 1,
                    spans: [],
                    spanAreaDefinitions: []
                };
            }
        };
    }());

    context = (function () {
        var grids = {},
            gridParts = {},
            namedGridTemplateAreas = {},
            indexedGridTemplateAreas = [],
            gridRenderer = (function () {

                function stripHash(selector) {
                    return selector.charAt(0) === '#' ? selector.substr(1) : selector;
                }

                function findOrConstructArea(identifier, base, area) {
                    var region = $('#' + identifier);

                    if (!region[0]) {
                        region = $(base);
                        region.attr('id', identifier);
                    }

                    if (area) {
                        region.css('width', area.width);
                        region.css('height', area.height);
                        region.css('position', 'absolute');
                        region.css('left', area.left);
                        region.css('top', area.top);
                    }

                    return region;
                }

                function buildArea(definition, area, selector) {
                    var identifier = stripHash(selector) +
                        '_mondrian_container' +
                        '_r' + definition.rowPosition +
                        '_c' + definition.columnPosition +
                        '_rs' + definition.rowSpan +
                        '_cs' + definition.columnSpan;

                    return findOrConstructArea(identifier, '<div />', area);
                }

                function addDebugLabel(regionId, area) {
                    var bugLabel = area.name || (area.row + ', ' + area.col),
                        bug;

                    bug = findOrConstructArea(regionId + '_h1', '<h1>' + bugLabel + '</h1>');
                    bug.css('padding', '10');

                    return bug;
                }

                function addDebugArea(area, selector) {

                    var regionId = stripHash(selector) +
                            '_debug_mondrian_' + area.name +
                            '_r' + area.row +
                            '_c' + area.col,

                        region = findOrConstructArea(regionId, '<div />', area.dimensions);

                    if (debug.labels) {
                        // Add a label if required.
                        region.append(addDebugLabel(regionId, area));
                    }

                    // Add an outline 
                    region.css('outline', '1px dashed fuchsia');
                    $(selector).append(region);
                }

                function defineArea(left, top, width, height) {
                    return {
                        left: left,
                        top: top,
                        width: width,
                        height: height
                    };
                }

                function aggregatePixelsAndFractions(definitions) {
                    var ret = {
                        pixels: 0,
                        fractions: 0
                    };
                    $.map(definitions, function (def) {
                        if (def.type === "px") {
                            ret.pixels += def.value;
                        } else if (def.type === "fr") {
                            ret.fractions += def.value;
                        } else if (def.type === "%") {
                            ret.pixels += def.height || def.width;
                        }
                    });
                    return ret;
                }

                function mapNamedPositionsToIndices(rows, columns) {

                    function matchName(name) {
                        return function (obj) {
                            return obj.name === name;
                        };
                    }

                    // Look up named grid lines for each gridPart
                    $.map(gridParts, function (definition) {
                        if (definition.leftGridLineName) {
                            definition.columnPosition =
                                $.firstMatchingIndex(columns, matchName(definition.leftGridLineName));
                        }
                        if (definition.rightGridLineName) {
                            definition.columnSpan =
                                $.firstMatchingIndex(columns, matchName(definition.rightGridLineName)) -
                                definition.columnPosition;
                        }
                        if (definition.topGridLineName) {
                            definition.rowPosition = $.firstMatchingIndex(rows, matchName(definition.topGridLineName));
                        }
                        if (definition.bottomGridLineName) {
                            definition.rowSpan = $.firstMatchingIndex(rows, matchName(definition.bottomGridLineName)) -
                                definition.rowPosition;
                        }
                    });
                }

                function padRowsAndColumns(rows, columns) {
                    // Increases the grid row / column count to include the largest specified row and column index.
                    // TODO: re-think zero vs. 1-indexing
                    var rowIx = rows.length - 1,
                        colIx = columns.length - 1,
                        maxRowIndex = 0,
                        maxColIndex = 0;

                    // Determine the largest row / column index
                    $.map(gridParts, function (part) {
                        maxRowIndex = Math.max(maxRowIndex, part.rowPosition);
                        maxColIndex = Math.max(maxColIndex, part.columnPosition);
                    });

                    while (rowIx < maxRowIndex) {
                        rowIx += 1;
                        rows[rowIx] = models.row({ size: "auto" });
                    }

                    while (colIx < maxColIndex) {
                        colIx += 1;
                        columns[colIx] = models.column({ size: "auto" });
                    }
                }

                function constructIndexedTemplateAreas(rows, columns) {
                    // If we only have named template areas, we need to map these onto indexed areas instead.
                    // TODO: allow both?
                    if (indexedGridTemplateAreas.length) {
                        return;
                    }

                    $.each(rows, function (ix) {
                        // Initialize each row in the multidimensional array.
                        indexedGridTemplateAreas[ix] = [];

                        $.each(columns, function (iix) {
                            // Initialize a basic grid component definition
                            var gta = models.gridComponent(),
                                gtaComponents,
                                spans = [];

                            gta.rowPosition = ix;
                            gta.columnPosition = iix;

                            // Determine which components have been defined as being inside this grid template area.
                            gtaComponents = $.map(gridParts, function (part) {
                                return (part.columnPosition === iix && part.rowPosition === ix) ? part : undefined;
                            });

                            spans = [];
                            // Collect any not (1, 1) row/column span definitions on the contained components
                            $.map(gtaComponents, function (component) {
                                if (component.rowSpan !== 1 || component.columnSpan !== 1) {
                                    spans.push([component.rowSpan, component.columnSpan]);
                                }
                            });

                            // Retain a reference to the additional spans, if there are any.
                            gta.spans = $.unique(spans);

                            // Place the grid template area definition in the appropriate location in our
                            // multidimensional array.
                            indexedGridTemplateAreas[ix][iix] = gta;
                        });
                    });
                }

                function constructGridAreas(rows, columns, selector) {
                    var left = 0,
                        top = 0,
                        width,
                        height,
                        colIx,
                        rowIx,
                        area;

                    $.each(rows, function (ix, row) {

                        left = 0;
                        $.each(columns, function (iix, col) {

                            var definition = indexedGridTemplateAreas[ix][iix];
                            if (definition) {
                                width = columns[iix].width;
                                height = rows[ix].height;
                                colIx = 1;
                                rowIx = 1;

                                while (rowIx < definition.rowSpan) {
                                    height += rows[ix + rowIx].height;
                                    rowIx += 1;
                                }
                                while (colIx < definition.columnSpan) {
                                    width += columns[iix + colIx].width;
                                    colIx += 1;
                                }

                                area = defineArea(left, top, width, height);

                                $.map(definition.spans, function (span) {

                                    while (rowIx < span[0]) {
                                        height += rows[ix + rowIx].height;
                                        rowIx += 1;
                                    }
                                    while (colIx < span[1]) {
                                        width += columns[iix + colIx].width;
                                        colIx += 1;
                                    }

                                    if (!definition.spanAreaDefinitions[span[0]]) {
                                        definition.spanAreaDefinitions[span[0]] = [];
                                    }

                                    definition.spanAreaDefinitions[span[0]][span[1]] =
                                        defineArea(left, top, width, height);

                                    width = area.width;
                                    height = area.height;
                                    rowIx = definition.rowSpan;
                                    colIx = definition.columnSpan;
                                });

                                definition.area = area;
                                indexedGridTemplateAreas[ix][iix] = definition;

                                if (debug.on) {
                                    addDebugArea({
                                        row: ix,
                                        col: iix,
                                        name: definition.name,
                                        dimensions: area
                                    }, selector);
                                }
                            }

                            left += col.width || 0;
                        });

                        top += row.height || 0;
                    });

                    if (debug.on && !debug.content) {
                        $.map(gridParts, function (definition) {
                            $(definition.object).remove();
                        });
                    }
                }

                function definePercentages(rows, columns, height, width) {
                    $.map(rows, function (row) {
                        row.definePercent(height);
                    });

                    $.map(columns, function (col) {
                        col.definePercent(width);
                    });
                }

                function defineFractions(rows, columns, height, width, selector) {
                    var fractionalWidth,
                        fractionalHeight,
                        frWidthUnit,
                        frHeightUnit,
                        rowValues = aggregatePixelsAndFractions(rows),
                        colValues = aggregatePixelsAndFractions(columns);

                    $(selector).css('min-height', rowValues.pixels);
                    $(selector).css('min-width', colValues.pixels);

                    if (height < rowValues.pixels) {
                        height = rowValues.pixels;
                        frHeightUnit = 0;
                    } else {
                        fractionalHeight = height - rowValues.pixels;
                        frHeightUnit = fractionalHeight / rowValues.fractions;
                    }

                    if (width < colValues.pixels) {
                        width = colValues.pixels;
                        frWidthUnit = 0;
                    } else {
                        fractionalWidth = width - colValues.pixels;
                        frWidthUnit = fractionalWidth / colValues.fractions;
                    }

                    $.map(rows, function (row) {
                        row.defineFraction(frHeightUnit);
                    });

                    $.map(columns, function (col) {
                        col.defineFraction(frWidthUnit);
                    });
                }

                function appendGridParts(selector) {
                    $.map(gridParts, function (definition) {
                        if (definition.object && definition.object[0]) {
                            var gta = indexedGridTemplateAreas[definition.rowPosition][definition.columnPosition],
                                area = gta.area,
                                dummyArea;
                            if (definition.rowSpan !== 1 || definition.columnSpan !== 1) {
                                area = gta.spanAreaDefinitions[definition.rowSpan][definition.columnSpan];
                            }

                            dummyArea = buildArea(definition, area, selector);
                            dummyArea.append(definition.object);
                            $(selector).append(dummyArea);
                        }
                    });
                }

                return {
                    render: function (grid, selector) {
                        var rows = grid.rows,
                            columns = grid.columns,
                            thisWidth = $(selector).width(),
                            thisHeight = $(selector).height();

                        mapNamedPositionsToIndices(rows, columns);

                        padRowsAndColumns(rows, columns);
                        constructIndexedTemplateAreas(rows, columns);

                        definePercentages(rows, columns, thisHeight, thisWidth);
                        defineFractions(rows, columns, thisHeight, thisWidth, selector);

                        constructGridAreas(rows, columns, selector);

                        if (!debug.on || debug.content) {
                            appendGridParts(selector);
                        }
                    }
                };
            }());

        return {
            getGridComponent: function (selector, object) {
                if (!gridParts[selector]) {
                    gridParts[selector] = models.gridComponent(object);
                }
                return gridParts[selector];
            },

            getGrid: function (selector) {
                if (!grids[selector]) {
                    grids[selector] = models.grid(selector);
                }
                return grids[selector];
            },

            getGridTemplateArea: function (name, row, col) {
                var gta;
                if (name) {
                    gta = namedGridTemplateAreas[name];
                }
                if (!gta && isFinite(row) && isFinite(col) && indexedGridTemplateAreas[row]) {
                    gta = indexedGridTemplateAreas[row][col];
                }
                return gta;
            },

            setGridTemplateArea: function (gta, name, row, col) {
                if (!namedGridTemplateAreas[name]) {
                    namedGridTemplateAreas[name] = gta;
                }
                if (!indexedGridTemplateAreas[row]) {
                    indexedGridTemplateAreas[row] = [];
                }
                if (!indexedGridTemplateAreas[row][col]) {
                    indexedGridTemplateAreas[row][col] = gta;
                }
                indexedGridTemplateAreas[row][col].name = name;
            },

            initializeGridRules: function () {
                $.map(grids, function (theGrid) {
                    theGrid.applyRules();
                });
            },

            renderAll: function () {
                $.each(grids, function (selector, theGrid) {
                    gridRenderer.render(theGrid, selector);
                });
            }
        };
    }());

    gridRules = (function () {

        function splitColumnRowDefinition(value) {
            // Parse a grid-definition-rows / grid-definition-columns value into its component parts.

            // Remove any excessive whitespace.
            var parts = value.replace(/\s+/g, " ").split(/\s/),
                joinBrackets,
                name,
                ret,
                joined;

            return $.map(parts, function (part) {
                // a part that is a string in quotes is a grid line name, not a width specification.
                if (part.match(/\"\w+\"/)) {
                    name = part.match(/^\"(\w+)\"$/)[1];
                    return undefined;
                }

                // We need to handle parenthesis in definitions (e.g. minmax(1fr, 50px)) by identifying when we are
                // opening / closing parenthesis.

                if (!joinBrackets && (!part.match(/\(/) || part.match(/\)/))) {
                    // This means that our part is a complete width specification - either no parentheses, or else
                    // an opening and closing parenthesis.
                    // TODO: handle nested parentheses.
                    ret = { name: name, size: part };
                    name = undefined;
                    return ret;
                }

                // If we are here then we need to aggregate parts up to the next closing parenthesis.
                if (!joinBrackets) {
                    joinBrackets = "";
                }

                joinBrackets += " " + part;

                if (part.match(/\)/)) {
                    // If our part includes a closing parenthesis then joinBrackets will now be a full width
                    // definition
                    joined = joinBrackets.trim();
                    joinBrackets = undefined;

                    ret = { name: name, size: joined };
                    name = undefined;
                    return ret;
                }

                return undefined;
            });
        }

        return {
            gridArea: function (selector, object, value) {
                var name = value.match(/^\"(\w+)\"$/)[1],
                    gta = context.getGridTemplateArea(name),
                    parts;

                if (gta) {
                    this.gridRowPosition(selector, object, gta.rowPosition + 1);
                    this.gridColumnPosition(selector, object, gta.columnPosition + 1);
                    this.gridRowSpan(selector, object, gta.rowSpan);
                    this.gridColumnSpan(selector, object, gta.columnSpan);
                    return;
                }

                parts = value.replace(/\s+/g, " ").split(/\s/);

                this.gridRowPosition(selector, object, parts[0]);

                if (parts[1] !== undefined) {
                    this.gridColumnPosition(selector, object, parts[1]);
                }
                if (parts.length > 3) {
                    this.gridSpan(selector, object, parts[2] + " " + parts[3]);
                } else if (parts.length > 2) {
                    this.gridSpan(selector, object, parts[2]);
                } else {
                    this.gridSpan(selector, object, "1");
                }
            },

            gridAutoColumns: function (selector, object, value) {
                //QQ?
            },

            gridAutoFlow: function (selector, object, value) {
            },

            gridAutoRows: function (selector, object, value) {
                //QQ?
            },

            gridColumnPosition: function (selector, object, value) {
                var gridComponent = context.getGridComponent(selector, object),
                    columnPosition = parseInt(value, 10) - 1;

                if (isFinite(columnPosition)) {
                    gridComponent.columnPosition = columnPosition;
                } else {
                    gridComponent.leftGridLineName = value.match(/^\"(\w+)\"$/)[1];
                }
            },

            gridColumnSpan: function (selector, object, value) {
                var gridComponent = context.getGridComponent(selector, object),
                    columnSpan = parseInt(value, 10);

                if (isFinite(columnSpan)) {
                    gridComponent.columnSpan = columnSpan;
                } else {
                    gridComponent.rightGridLineName = value.match(/^\"(\w+)\"$/)[1];
                }
            },

            gridColumn: function (selector, object, value) {
                var parts = value.replace(/\s+/g, " ").split(/\s/);

                this.gridColumnPosition(selector, object, parts[0]);
                if (parts.length > 1) {
                    this.gridColumnSpan(selector, object, parts[1]);
                }
            },

            gridDefinitionColumns: function (selector, object, value) {
                var columnDefs = splitColumnRowDefinition(value),
                    theGrid = context.getGrid(selector);

                theGrid.columns = $.map(columnDefs, function (def) {
                    return models.column(def);
                });
            },

            gridDefinitionRows: function (selector, object, value) {
                var rowDefs = splitColumnRowDefinition(value),
                    theGrid = context.getGrid(selector);

                theGrid.rows = $.map(rowDefs, function (def) {
                    return models.row(def);
                });
            },

            gridPosition: function (selector, object, value) {
                var parts = value.replace(/\s+/g, " ").split(/\s/);
                this.gridRowPosition(selector, object, parts[0]);

                if (parts.length > 1) {
                    this.gridColumnPosition(selector, object, parts[1]);
                } else {
                    this.gridColumnPosition(selector, object, parts[0]);
                }
            },

            gridRowPosition: function (selector, object, value) {
                var gridComponent = context.getGridComponent(selector, object),
                    rowPosition = parseInt(value, 10) - 1;

                if (isFinite(rowPosition)) {
                    gridComponent.rowPosition = rowPosition;
                } else {
                    gridComponent.topGridLineName = value.match(/^\"(\w+)\"$/)[1];
                }
            },

            gridRowSpan: function (selector, object, value) {
                var gridComponent = context.getGridComponent(selector, object),
                    rowSpan = parseInt(value, 10);

                if (isFinite(rowSpan)) {
                    gridComponent.rowSpan = rowSpan;
                } else {
                    gridComponent.bottomGridLineName = value.match(/^\"(\w+)\"$/)[1];
                }
            },

            gridRow: function (selector, object, value) {
                var parts = value.replace(/\s+/g, " ").split(/\s/);

                this.gridRowPosition(selector, object, parts[0]);
                if (parts.length > 1) {
                    this.gridRowSpan(selector, object, parts[1]);
                }
            },

            gridSpan: function (selector, object, value) {
                var parts = value.replace(/\s+/g, " ").split(/\s/);

                this.gridRowSpan(selector, object, parts[0]);
                if (parts.length > 1) {
                    this.gridColumnSpan(selector, object, parts[1]);
                } else {
                    this.gridColumnSpan(selector, object, parts[0]);
                }
            },

            gridTemplate: function (selector, object, value) {
                var rows = value.split(/\r?\n/),
                    columnCount,
                    grid;

                grid = $.map(rows, function (row) {
                    var columns = row.match(/\w+/g);
                    if (!columnCount) {
                        columnCount = columns.length;
                    }
                    return columns;
                });

                $.each(grid, function (ix, def) {
                    var row = parseInt(ix / columnCount, 10),
                        col = ix % columnCount,
                        gta = context.getGridTemplateArea(def, row, col),
                        rowSpan,
                        colSpan;

                    if (!gta) {
                        gta = models.gridComponent();
                        gta.name = def;
                        gta.rowPosition = row;
                        gta.columnPosition = col;

                        rowSpan = 1;
                        colSpan = 1;

                        while (grid[ix + (rowSpan * columnCount)] === def) {
                            rowSpan += 1;
                        }
                        while (grid[ix + colSpan] === def && colSpan < columnCount) {
                            colSpan += 1;
                        }

                        gta.rowSpan = rowSpan;
                        gta.columnSpan = colSpan;

                        if (rowSpan > 1 || colSpan > 1) {
                            gta.spans = [[rowSpan, colSpan]];
                        }

                        context.setGridTemplateArea(gta, def, row, col);
                    } else if (!context.getGridTemplateArea(def)) {
                        context.setGridTemplateArea(gta, def, row, col);
                    }
                });
            }
        };
    }());

    cssHandler = (function () {

        var usedCSSDefs = [],
            cssDefs = {};

        function toCamelCase(hyphenated) {
            return hyphenated.replace(/-([a-z])/gi, function (s, group) {
                return group.toUpperCase();
            });
        }

        function isW3CGrid(rule) {
            if (rule.property === "display") {
                return rule.valueText.match(/grid$/);
            }
            return gridRules.hasOwnProperty(toCamelCase(rule.property));
        }

        function handleGridRule(selector, object, rule) {
            if (rule.property === "display") {
                object.css("display", rule.valueText.replace('grid', 'block'));
            } else {
                var ruleName = toCamelCase(rule.property);
                gridRules[ruleName](selector, object, rule.valueText);
            }
        }

        function applyRule(selector, object, rule) {
            if (!isW3CGrid(rule)) {
                object.css(rule.property, rule.valueText);
            } else {
                handleGridRule(selector, object, rule);
            }
        }

        function initializeCssRules(css) {
            $.map(css.cssRules, function (rule) {
                if (rule instanceof jscsspStyleRule) {
                    cssDefs[rule.mSelectorText] = rule;
                    var display;
                    $.map(rule.declarations, function (declaration) {
                        if (declaration instanceof jscsspDeclaration &&
                                declaration.property === "display") {
                            display = declaration.valueText;
                        }
                    });
                    if (display) {
                        cssHandler.applyRules(rule.mSelectorText, $(rule.mSelectorText));
                    }
                }
            });
        }

        function applyRules(selector, object) {
            if (object) {
                var rules = cssDefs[selector].declarations;

                $.map(rules, function (rule) {
                    if (rule instanceof jscsspDeclaration) {
                        applyRule(selector, object, rule);
                    }
                });

                usedCSSDefs.push(selector);
            } else {
                $(selector).children().each(function (ix, child) {
                    $.each(cssDefs, function (def) {
                        if ($(child).is(def)) {
                            cssHandler.applyRules(def, $(child));
                        }
                    });
                });
            }
        }

        return {
            initializeCssRules: initializeCssRules,
            applyRules: applyRules,
            applyUnusedRules: function () {
                $.each(cssDefs, function (selector) {
                    if ($.inArray(selector, usedCSSDefs) < 0) {
                        applyRules(selector, $(selector));
                    }
                });
            }
        };
    }());

    $.extend({
        mondrian: function (css) {
            cssHandler.initializeCssRules(css);
            context.initializeGridRules();

            cssHandler.applyUnusedRules();

            $.throttledResize(10, context.renderAll);
            context.renderAll();
        }
    });

    (function () {
        var scripts = document.getElementsByTagName('script'),
            cssFile;

        // Find our stylesheet
        // TODO: restrict to the actual script tag that matches this file?
        $.map(scripts, function (script) {
            if (script.getAttribute('data-stylesheet')) {
                cssFile = script.getAttribute('data-stylesheet');
            }
            return cssFile;
        });

        if (cssFile) {
            debug.configure(cssFile);

            // Get and parse the css file
            $.get(cssFile, function (data) {
                var parser = new CSSParser(),
                    sheet = parser.parse(data);

                // Apply the file to our page
                $.mondrian(sheet);
            });
        }
    }());
}(jQuery));