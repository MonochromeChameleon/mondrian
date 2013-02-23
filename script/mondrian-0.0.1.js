/*globals jQuery, CSSParser, jscsspDeclaration, jscsspStyleRule */
/*jslint browser: true, vars: true */

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

    var utils = {
        firstMatchingIndex: function (array, callback) {
            var ix;
            $.each(array, function (ii, obj) {
                if (callback(obj)) {
                    ix = ii;
                }
                return !ix; // break out on finding the appropriate index
            });
            return ix;
        },
        throttledResize: function (delay, callback) {
            var timeout;
            window.onresize = function () {
                if (timeout) {
                    clearTimeout(timeout);
                }
                timeout = setTimeout(callback, delay);
            };
        },
        toCamelCase: function (hyphenated) {
            return hyphenated.replace(/-([a-z])/gi, function (s, group) {
                return group.toUpperCase();
            });
        }
    };

    var debug = (function () {
        // Uses query-string inspection either on the browser, or the css file path definition, to switch to debug
        // rendering.

        var debugRegex = /mondrian-(debug|labels|outline)/,
            labelsRegex = /mondrian-labels/,
            outlineRegex = /mondrian-outline/,
            noDebugRegex = /mondrian-no-debug/,

            queryString = window.location.search,

            self = {};

        $.extend(self, {
            on: false,
            labels: false,
            content: false,
            configure: function (cssFilePath) {
                // Allow override in the browser of a debug-enabled css file path.
                if ((window.location.search.match(noDebugRegex))) {
                    return;
                }

                if (queryString.match(debugRegex) || cssFilePath.match(debugRegex)) {
                    self.on = true;
                    self.labels = queryString.match(labelsRegex) || cssFilePath.match(labelsRegex);
                    self.content = queryString.match(outlineRegex) || cssFilePath.match(outlineRegex);
                }
            }
        });

        return self;
    }());

    var models = (function () {

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
                    name: name
                };

                $.extend(ret, {
                    definePercent: function (gridSize) {
                        if (ret.type === "%") {
                            ret[isRow ? "height" : "width"] = (ret.value * gridSize / 100);
                        }
                    },

                    defineFraction: function (frSizeUnit) {
                        if (ret.type === "fr") {
                            ret[isRow ? "height" : "width"] = (ret.value * frSizeUnit);
                        }
                    }
                });

                ret[isRow ? "height" : "width"] = heightOrWidth;

                return ret;
            };
        }

        return {
            row: rowCol(true),
            column: rowCol(false),
            gridComponent: function (selector, object) {
                return {
                    selector: selector,
                    object: object,
                    rowSpan: 1,
                    columnSpan: 1,
                    spans: [],
                    spanAreaDefinitions: []
                };
            }
        };
    }());

    var IndexedArrayMap = function () { };

    IndexedArrayMap.prototype.push = function (identifier, value) {
        if (!this[identifier]) {
            this[identifier] = [];
        }
        if (value instanceof Array) {
            for (var i = 0; i < value.length; i += 1) {
                this[identifier].push(value[i]);
            }
        } else {
            this[identifier].push(value);
        }
    };

    IndexedArrayMap.constructor = IndexedArrayMap;

    var Thinger = function (thingmaker) {
        this.thingmaker = thingmaker;
    };

    Thinger.prototype.get = function () {
        var args = $.makeArray(arguments);
        if (!this[args[0]]) {
            this[args[0]] = this.thingmaker.apply(undefined, args);
        }
        return this[args[0]];
    };

    Thinger.constructor = Thinger;

    var GridRuleHandler = function (grid) {
        this.grid = grid;
    };

    (function () {
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

        function gridRowPosition(selector, object, value, grid) {
            var gridComponent = grid.getGridComponent(selector, object),
                rowPosition = parseInt(value, 10) - 1;

            if (isFinite(rowPosition)) {
                gridComponent.rowPosition = rowPosition;
            } else {
                gridComponent.topGridLineName = value.match(/^\"(\w+)\"$/)[1];
            }
        }

        function gridColumnPosition(selector, object, value, grid) {
            var gridComponent = grid.getGridComponent(selector, object),
                columnPosition = parseInt(value, 10) - 1;

            if (isFinite(columnPosition)) {
                gridComponent.columnPosition = columnPosition;
            } else {
                gridComponent.leftGridLineName = value.match(/^\"(\w+)\"$/)[1];
            }
        }

        function gridColumnSpan(selector, object, value, grid) {
            var gridComponent = grid.getGridComponent(selector, object),
                columnSpan = parseInt(value, 10);

            if (isFinite(columnSpan)) {
                gridComponent.columnSpan = columnSpan;
            } else {
                gridComponent.rightGridLineName = value.match(/^\"(\w+)\"$/)[1];
            }
        }

        function gridRowSpan(selector, object, value, grid) {
            var gridComponent = grid.getGridComponent(selector, object),
                rowSpan = parseInt(value, 10);

            if (isFinite(rowSpan)) {
                gridComponent.rowSpan = rowSpan;
            } else {
                gridComponent.bottomGridLineName = value.match(/^\"(\w+)\"$/)[1];
            }
        }

        function gridSpan(selector, object, value, grid) {
            var parts = value.replace(/\s+/g, " ").split(/\s/);

            gridRowSpan(selector, object, parts[0], grid);
            if (parts.length > 1) {
                gridColumnSpan(selector, object, parts[1], grid);
            } else {
                gridColumnSpan(selector, object, parts[0], grid);
            }
        }

        function gridArea(selector, object, value, grid) {
            var name = value.match(/^\"(\w+)\"$/)[1],
                gta = grid.getGridTemplateArea(name),
                parts;

            if (gta) {

                gridRowPosition(selector, object, gta.rowPosition + 1, grid);
                gridColumnPosition(selector, object, gta.columnPosition + 1, grid);
                gridRowSpan(selector, object, gta.rowSpan, grid);
                gridColumnSpan(selector, object, gta.columnSpan, grid);
                return;
            }

            parts = value.replace(/\s+/g, " ").split(/\s/);

            gridRowPosition(selector, object, parts[0], grid);

            if (parts[1] !== undefined) {
                gridColumnPosition(selector, object, parts[1], grid);
            }
            if (parts.length > 3) {
                gridSpan(selector, object, parts[2] + " " + parts[3], grid);
            } else if (parts.length > 2) {
                gridSpan(selector, object, parts[2], grid);
            } else {
                gridSpan(selector, object, "1", grid);
            }
        }

        function gridColumn(selector, object, value, grid) {
            var parts = value.replace(/\s+/g, " ").split(/\s/);

            gridColumnPosition(selector, object, parts[0], grid);
            if (parts.length > 1) {
                gridColumnSpan(selector, object, parts[1], grid);
            }
        }

        function gridRow(selector, object, value, grid) {
            var parts = value.replace(/\s+/g, " ").split(/\s/);

            gridRowPosition(selector, object, parts[0], grid);
            if (parts.length > 1) {
                gridRowSpan(selector, object, parts[1], grid);
            }
        }

        function gridDefinitionColumns(selector, object, value, grid) {
            var columnDefs = splitColumnRowDefinition(value);

            grid.columns = $.map(columnDefs, function (def) {
                return models.column(def);
            });
        }

        function gridDefinitionRows(selector, object, value, grid) {
            var rowDefs = splitColumnRowDefinition(value);

            grid.rows = $.map(rowDefs, function (def) {
                return models.row(def);
            });
        }

        function gridPosition(selector, object, value, grid) {
            var parts = value.replace(/\s+/g, " ").split(/\s/);
            gridRowPosition(selector, object, parts[0], grid);

            if (parts.length > 1) {
                gridColumnPosition(selector, object, parts[1], grid);
            } else {
                gridColumnPosition(selector, object, parts[0], grid);
            }
        }

        function gridTemplate(selector, object, value, grid) {
            var rows = value.split(/\r?\n/),
                columnCount,
                theTemplate;

            theTemplate = $.map(rows, function (row) {
                var columns = row.match(/\w+/g);
                if (!columnCount) {
                    columnCount = columns.length;
                }
                return columns;
            });

            $.each(theTemplate, function (ix, def) {
                var row = parseInt(ix / columnCount, 10),
                    col = ix % columnCount,
                    gta = grid.getGridTemplateArea(def, row, col),
                    rowSpan,
                    colSpan;

                if (!gta) {
                    gta = models.gridComponent();
                    gta.name = def;
                    gta.rowPosition = row;
                    gta.columnPosition = col;

                    rowSpan = 1;
                    colSpan = 1;

                    while (theTemplate[ix + (rowSpan * columnCount)] === def) {
                        rowSpan += 1;
                    }
                    while (theTemplate[ix + colSpan] === def && colSpan < columnCount) {
                        colSpan += 1;
                    }

                    gta.rowSpan = rowSpan;
                    gta.columnSpan = colSpan;

                    if (rowSpan > 1 || colSpan > 1) {
                        gta.spans = [[rowSpan, colSpan]];
                    }

                    grid.setGridTemplateArea(gta, def, row, col);
                } else if (!grid.getGridTemplateArea(def)) {
                    grid.setGridTemplateArea(gta, def, row, col);
                }
            });
        }

        GridRuleHandler.prototype.gridArea = function (selector, object, value) {
            gridArea(selector, object, value, this.grid);
        };

        GridRuleHandler.prototype.gridAutoColumns = function (selector, object, value) {
            //QQ?
        };

        GridRuleHandler.prototype.gridAutoFlow = function (selector, object, value) {
        };

        GridRuleHandler.prototype.gridAutoRows = function (selector, object, value) {
            //QQ?
        };

        GridRuleHandler.prototype.gridColumnPosition = function (selector, object, value) {
            gridColumnPosition(selector, object, value, this.grid);
        };

        GridRuleHandler.prototype.gridColumnSpan = function (selector, object, value) {
            gridColumnSpan(selector, object, value, this.grid);
        };

        GridRuleHandler.prototype.gridColumn = function (selector, object, value) {
            gridColumn(selector, object, value, this.grid);
        };

        GridRuleHandler.prototype.gridDefinitionColumns = function (selector, object, value) {
            gridDefinitionColumns(selector, object, value, this.grid);
        };

        GridRuleHandler.prototype.gridDefinitionRows = function (selector, object, value) {
            gridDefinitionRows(selector, object, value, this.grid);
        };

        GridRuleHandler.prototype.gridPosition = function (selector, object, value) {
            gridPosition(selector, object, value, this.grid);
        };

        GridRuleHandler.prototype.gridRowPosition = function (selector, object, value) {
            gridRowPosition(selector, object, value, this.grid);
        };

        GridRuleHandler.prototype.gridRowSpan = function (selector, object, value) {
            gridRowSpan(selector, object, value, this.grid);
        };

        GridRuleHandler.prototype.gridRow = function (selector, object, value) {
            gridRow(selector, object, value, this.grid);
        };

        GridRuleHandler.prototype.gridSpan = function (selector, object, value) {
            gridSpan(selector, object, value, this.grid);
        };

        GridRuleHandler.prototype.gridTemplate = function (selector, object, value) {
            gridTemplate(selector, object, value, this.grid);
        };
    }());

    GridRuleHandler.constructor = GridRuleHandler;

    var CSSHandler = function (applicableRules, gridRuleHandler) {
        this.applicableRules = applicableRules;
        this.gridRuleHandler = gridRuleHandler;
    };

    (function () {
        function handleGridRule(targetId, target, rule, ruleHandler) {
            if (rule.property === "display") {
                target.css("display", rule.valueText.replace('grid', 'block'));
            } else {
                var ruleName = utils.toCamelCase(rule.property);
                ruleHandler[ruleName](targetId, target, rule.valueText);
            }
        }

        function applyObjectRules(targetId, target, rules, ruleHandler) {
            $.map(rules || [], function (rule) {
                if (rule instanceof jscsspDeclaration) {
                    if (rule.property !== "display" || (rule.property !== "grid-template" && !rule.property.match(/^grid-definition-/))) {
                        handleGridRule(targetId, target, rule, ruleHandler);
                    }
                } else if (rule instanceof jscsspStyleRule) {
                    applyObjectRules(targetId, target, rule.declarations);
                }
            });
        }

        CSSHandler.prototype.applyRules = function (targetId, target) {
            var rules;
            var ruleHandler = this.gridRuleHandler;
            var allRules = this.applicableRules;

            if (target) {
                rules = allRules[targetId];
                applyObjectRules(targetId, target, rules, ruleHandler);
            } else {
                $(targetId).children().each(function (ix, child) {
                    $.each(allRules, function (childSelector, defs) {
                        var c = $(child);
                        if (c.is(childSelector)) {
                            applyObjectRules(childSelector, c, defs, ruleHandler);
                        }
                    });
                });
            }
        };
        CSSHandler.prototype.applyGridSetupRules = function (targetId, target, rules) {
            var ruleHandler = this.gridRuleHandler;

            $.each(rules, function (ix, rule) {
                handleGridRule(targetId, target, rule, ruleHandler);
            });
        };
    }());

    CSSHandler.constructor = CSSHandler;

    var GridBuilder = function (selector, debug) {
        this.selector = selector;
    };

    (function () {
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

        function definePercentages(rows, columns, height, width) {
            $.map(rows, function (row) {
                row.definePercent(height);
            });

            $.map(columns, function (col) {
                col.definePercent(width);
            });
        }

        function defineFractions(rows, columns, height, width, gridId) {
            var fractionalWidth,
                fractionalHeight,
                frWidthUnit,
                frHeightUnit,
                rowValues = aggregatePixelsAndFractions(rows),
                colValues = aggregatePixelsAndFractions(columns);

            $(gridId).css('min-height', rowValues.pixels);
            $(gridId).css('min-width', colValues.pixels);

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

        GridBuilder.prototype.build = function (rows, columns) {
            var thisWidth = $(this.selector).width(),
                thisHeight = $(this.selector).height();

            definePercentages(rows, columns, thisHeight, thisWidth);
            defineFractions(rows, columns, thisHeight, thisWidth, this.selector);
        };
    }());

    GridBuilder.constructor = GridBuilder;

    var GridRenderer = function (selector, grid, gridParts) {
        this.selector = selector;
        this.grid = grid;
        this.gridParts = gridParts;
    };

    (function () {
        function stripHash(hashed) {
            return hashed.charAt(0) === '#' ? hashed.substr(1) : hashed;
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

        function buildArea(definition, area, parentId) {
            var identifier = stripHash(parentId) +
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

        function addDebugArea(area, parentId) {

            var regionId = stripHash(parentId) +
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
            $(parentId).append(region);
        }

        function defineArea(left, top, width, height) {
            return {
                left: left,
                top: top,
                width: width,
                height: height
            };
        }

        function mapNamedPositionsToIndices(rows, columns, gridParts) {

            function matchName(name) {
                return function (obj) {
                    return obj.name === name;
                };
            }

            // Look up named grid lines for each gridPart
            $.map(gridParts, function (definition) {
                if (definition.leftGridLineName) {
                    definition.columnPosition =
                        utils.firstMatchingIndex(columns, matchName(definition.leftGridLineName));
                }
                if (definition.rightGridLineName) {
                    definition.columnSpan =
                        utils.firstMatchingIndex(columns, matchName(definition.rightGridLineName)) -
                        definition.columnPosition;
                }
                if (definition.topGridLineName) {
                    definition.rowPosition = utils.firstMatchingIndex(rows, matchName(definition.topGridLineName));
                }
                if (definition.bottomGridLineName) {
                    definition.rowSpan = utils.firstMatchingIndex(rows, matchName(definition.bottomGridLineName)) -
                        definition.rowPosition;
                }
            });
        }

        function padRowsAndColumns(rows, columns, gridParts) {
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

        function constructIndexedTemplateAreas(rows, columns, grid, gridParts) {
            // If we only have named template areas, we need to map these onto indexed areas instead.
            // TODO: allow both?
            if (grid.indexedGridTemplateAreas.length) {
                return;
            }

            $.each(rows, function (ix) {
                // Initialize each row in the multidimensional array.
                grid.indexedGridTemplateAreas[ix] = [];

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
                    grid.indexedGridTemplateAreas[ix][iix] = gta;
                });
            });
        }

        function constructGridAreas(rows, columns, areaId, grid, gridParts) {
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

                    var definition = grid.indexedGridTemplateAreas[ix][iix];
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
                        grid.indexedGridTemplateAreas[ix][iix] = definition;

                        if (debug.on) {
                            addDebugArea({
                                row: ix,
                                col: iix,
                                name: definition.name,
                                dimensions: area
                            }, areaId);
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

        function appendGridParts(areaId, grid, gridParts) {
            $.map(gridParts, function (definition) {
                if (definition.object && definition.object[0]) {
                    var gta = grid.indexedGridTemplateAreas[definition.rowPosition][definition.columnPosition],
                        area = gta.area,
                        dummyArea;
                    if (definition.rowSpan !== 1 || definition.columnSpan !== 1) {
                        area = gta.spanAreaDefinitions[definition.rowSpan][definition.columnSpan];
                    }

                    dummyArea = buildArea(definition, area, areaId);
                    dummyArea.append(definition.object);
                    $(areaId).append(dummyArea);
                }
            });
        }

        GridRenderer.prototype.render = function (rows, columns, gridBuilder) {
            mapNamedPositionsToIndices(rows, columns, this.gridParts);

            padRowsAndColumns(rows, columns, this.gridParts);
            constructIndexedTemplateAreas(rows, columns, this.grid, this.gridParts);
            gridBuilder.build(rows, columns);
            constructGridAreas(rows, columns, this.selector, this.grid, this.gridParts);

            if (!debug.on || debug.content) {
                appendGridParts(this.selector, this.grid, this.gridParts);
            }
        };
    }());

    GridRenderer.constructor = GridRenderer;

    var Grid = function (selector) {
        this.selector = selector;
        this.object = $(selector);
        this.applicableRules = new IndexedArrayMap();
        this.gridParts = new Thinger(models.gridComponent);
        this.rows = [];
        this.columns = [];
        this.indexedGridTemplateAreas = [];
        this.namedGridTemplateAreas = {};
    };

    (function () {

        function getOrFilterGridSetupRules(rules, getOrFilter) {
            return $.map(rules, function (rule) {
                if (rule.property === "display" || rule.property === "grid-template" || rule.property.match(/^grid-definition-/)) {
                    return getOrFilter ? rule : undefined;
                }
                return getOrFilter ? undefined : rule;
            });
        }

        function getGridSetupRules(rules) {
            return getOrFilterGridSetupRules(rules, true);
        }

        function filterGridSetupRules(rules) {
            return getOrFilterGridSetupRules(rules, false);
        }

        Grid.prototype.getGridComponent = function (targetId, object) {
            return this.gridParts.get(targetId, object);
        };

        Grid.prototype.getGridTemplateArea = function (name, row, col) {
            var gta;
            if (name) {
                gta = this.namedGridTemplateAreas[name];
            }
            if (!gta && isFinite(row) && isFinite(col) && this.indexedGridTemplateAreas[row]) {
                gta = this.indexedGridTemplateAreas[row][col];
            }
            return gta;
        };

        Grid.prototype.setGridTemplateArea = function (gta, name, row, col) {
            if (!this.namedGridTemplateAreas[name]) {
                this.namedGridTemplateAreas[name] = gta;
            }
            if (!this.indexedGridTemplateAreas[row]) {
                this.indexedGridTemplateAreas[row] = [];
            }
            if (!this.indexedGridTemplateAreas[row][col]) {
                this.indexedGridTemplateAreas[row][col] = gta;
            }
            this.indexedGridTemplateAreas[row][col].name = name;
        };

        Grid.prototype.identifyRules = function (indexedCssRules) {
            var applicableRules = this.applicableRules;
            var gridSetupRules = getGridSetupRules(indexedCssRules[this.selector]);
            applicableRules.push(this.selector, gridSetupRules);

            this.object.children().each(function (ix, child) {
                $.each(indexedCssRules, function (identifier, rules) {
                    if ($(child).is(identifier)) {
                        applicableRules.push(identifier, filterGridSetupRules(rules));
                    }
                });
            });
        };

        Grid.prototype.initializeGrid = function () {
            var gridRuleHandler = new GridRuleHandler(this);
            this.cssHandler = new CSSHandler(this.applicableRules, gridRuleHandler);
            var gridSetupRules = this.applicableRules[this.selector];
            this.cssHandler.applyGridSetupRules(this.selector, this.object, gridSetupRules);
        };

        Grid.prototype.initializeRules = function () {
            this.cssHandler.applyRules(this.selector, this.object);
            this.cssHandler.applyRules(this.selector);
            this.gridRenderer = new GridRenderer(this.selector, this, this.gridParts);
        };

        Grid.prototype.render = function () {
            var gridBuilder = new GridBuilder(this.selector, debug, this.gridParts);
            this.gridRenderer.render(this.rows, this.columns, gridBuilder);
        };
    }());

    Grid.constructor = Grid;

    function mondrian(css) {

        var grids = [],
            grh = new GridRuleHandler(),
            nonGridRules = new IndexedArrayMap(),
            gridRules = new IndexedArrayMap();

        function isW3CGrid(rule) {
            if (rule.property === "display") {
                return rule.valueText.match(/grid$/);
            }
            var cc = utils.toCamelCase(rule.property);
            return (typeof grh[cc] === "function");
        }

        function splitCssByGridStatus() {
            $.each(css.cssRules, function (ix, rule) {
                $.each(rule.declarations, function (iix, def) {
                    (isW3CGrid(def) ? gridRules : nonGridRules).push(rule.mSelectorText, def);
                });
            });
        }

        function applyNonGridRules() {
            $.each(nonGridRules, function (selector, rules) {
                $.each(rules, function (ix, rule) {
                    $(selector).css(rule.property, rule.valueText);
                });
            });
        }

        function findGridIdentifiers(css) {
            var gridIds = [];
            $.each(gridRules, function (selector, rules) {
                var isGridId = !!$.map(rules, function (def) {
                    return def.property === "display" && def.valueText.match(/grid$/) ? true : undefined;
                }).length;
                if (isGridId) {
                    gridIds.push(selector);
                }
            });
            return gridIds;
        }

        function determineDependencies(gridIds) {
            var dependencies = {};
            $.each(gridIds, function (ix, gridId) {
                dependencies[gridId] = $.map(gridIds, function (id) {
                    if (gridId === id) {
                        return undefined;
                    }
                    if (!!$(id).has(gridId).length) {
                        return id;
                    }
                });
            });
            return dependencies;
        }

        function buildGrid(gridIds, dependentGrids, builtGridIds) {
            $.each(gridIds, function (ix, gridId) {
                if ($.inArray(gridId, builtGridIds) < 0) {
                    var dependencies = dependentGrids[gridId];
                    var dependenciesBuilt = true;
                    $.each(dependencies || [], function (iix, dependent) {
                        if ($.inArray(dependent, builtGridIds) < 0) {
                            dependenciesBuilt = false;
                        }
                        return dependenciesBuilt;
                    });
                    if (dependenciesBuilt) {
                        grids.push(new Grid(gridId));
                        builtGridIds.push(gridId);
                    }
                }
            });
        }

        function createGrids() {
            var gridIds = $.unique(findGridIdentifiers(css));
            var dependentGrids = determineDependencies(gridIds);
            var builtGridIds = [];


            while (builtGridIds.length < gridIds.length) {
                buildGrid(gridIds, dependentGrids, builtGridIds);
            }
        }

        function identifyGridRules() {
            $.each(grids, function (selector, grid) {
                grid.identifyRules(gridRules);
            });
        }

        function initializeGrids() {
            $.each(grids, function (selector, grid) {
                grid.initializeGrid();
            });
        }

        function initializeGridRules() {
            $.map(grids, function (grid) {
                grid.initializeRules();
            });
        }

        function renderAll() {
            $.each(grids, function (selector, grid) {
                grid.render();
            });
        }

        splitCssByGridStatus();
        applyNonGridRules();
        createGrids();
        identifyGridRules();
        initializeGrids();
        initializeGridRules();

        utils.throttledResize(10, renderAll);
        renderAll();
    }

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
                mondrian(sheet);
            });
        }
    }());
}(jQuery));