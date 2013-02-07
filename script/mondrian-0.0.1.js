/*
 Not-found named grid areas
 Named grid lines
 Row/column span on grid-area definitions
 Auto flow
 Repeat
 width / height: [min-/max-]content, minmax, auto = minmax(min-content, max-content)
 */
/*globals jQuery, CSSParser, jscsspDeclaration, jscsspStyleRule */
/*jslint unparam: true, browser: true */
(function ($) {
    "use strict";

    var utils,
        models,
        gridRules,
        ruleHandler,
        scripts = document.getElementsByTagName('script'),
        gridDisplays = ["grid", "inline-grid"],
        debug = window.location.search.match(/mondrian-(debug|labels)/),
        labels = window.location.search.match(/mondrian-labels/),
        cssFile,
        cssDefs = {},
        usedCSSDefs = [],
        grids = {},
        gridParts = {},
        indexedGridTemplateAreas = [],
        namedGridTemplateAreas = {};

    utils = (function () {

        function stripHash(selector) {
            return selector.charAt(0) === '#' ? selector.substr(1) : selector;
        }

        function constructArea(identifier, base, area) {
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

        function addDebugArea(area, selector) {
            var regionId = stripHash(selector) + '_debug_mondrian_' + area.name + '_r' + area.row + '_c' + area.col,
                region = constructArea(regionId, '<div />', area.dimensions),
                bugDesc = area.name || (area.row + ', ' + area.col),
                bug;

            if (labels) {
                bug = constructArea(regionId + '_h1', '<h1>' + bugDesc + '</h1>');
                bug.css('padding', '10');
                region.append(bug);
            }

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

        function findIndexOfNamedDefinition(name, definitions) {
            var defIx;
            $.each(definitions, function (ix, def) {
                if (def.name === name) {
                    defIx = ix;
                    return false;
                }
                return true;
            });
            return defIx;
        }

        return {
            buildArea: function (definition, area, selector) {
                var identifier = stripHash(selector) + '_mondrian_container_r' + definition.rowPosition + '_c' + definition.columnPosition + '_rs' + definition.rowSpan + '_cs' + definition.columnSpan;

                return constructArea(identifier, '<div />', area);
            },

            mapNamedPositionsToIndices: function (rows, columns) {
                var rightIndex,
                    bottomIndex;

                $.map(gridParts, function (definition) {
                    if (definition.leftGridLineName) {
                        definition.columnPosition = findIndexOfNamedDefinition(definition.leftGridLineName, columns);
                    }
                    if (definition.rightGridLineName) {
                        rightIndex = findIndexOfNamedDefinition(definition.rightGridLineName, columns);
                        definition.columnSpan = rightIndex - definition.columnPosition;
                    }
                    if (definition.topGridLineName) {
                        definition.rowPosition = findIndexOfNamedDefinition(definition.topGridLineName, rows);
                    }
                    if (definition.bottomGridLineName) {
                        bottomIndex = findIndexOfNamedDefinition(definition.bottomGridLineName, rows);
                        definition.rowSpan = bottomIndex - definition.rowPosition;
                    }
                });
            },

            padRowsAndColumns: function (maxRowIndex, maxColIndex, rows, columns) {
                var rowIx = rows.length - 1,
                    colIx = columns.length - 1;

                while (rowIx < maxRowIndex) {
                    rowIx += 1;
                    rows[rowIx] = models.row({size: "auto"});
                }

                while (colIx < maxColIndex) {
                    colIx += 1;
                    columns[colIx] = models.column({size: "auto"});
                }

            },

            constructIndexedTemplateAreas: function (rows, columns) {
                if (indexedGridTemplateAreas.length) {
                    return;
                }

                $.each(rows, function (ix) {
                    indexedGridTemplateAreas[ix] = [];
                    $.each(columns, function (iix) {
                        var gta = models.gridComponent(),
                            gtaComponents,
                            spans = [];

                        gta.rowPosition = ix;
                        gta.columnPosition = iix;

                        gtaComponents = $.map(gridParts, function (part) {
                            return (part.columnPosition === iix && part.rowPosition === ix) ? part : undefined;
                        });

                        spans = [];
                        $.map(gtaComponents, function (component) {
                            if (component.rowSpan !== 1 || component.columnSpan !== 1) {
                                spans.push([component.rowSpan, component.columnSpan]);
                            }
                        });

                        gta.spans = $.unique(spans);

                        indexedGridTemplateAreas[ix][iix] = gta;
                    });
                });
            },

            splitColumnRowDefinition: function (value) {
                var parts = value.replace(/\s+/g, " ").split(/\s/),
                    joinBrackets,
                    name,
                    ret,
                    joined;

                return $.map(parts, function (part) {
                    if (part.match(/\"\w+\"/)) {
                        name = part.match(/^\"(\w+)\"$/)[1];
                        return undefined;
                    }

                    if (!joinBrackets && !part.match(/\(/)) {
                        ret = name ? { name: name, size: part } : { size: part };
                        name = undefined;
                        return ret;
                    }

                    if (!joinBrackets) {
                        joinBrackets = "";
                    }

                    joinBrackets += " " + part;

                    if (part.match(/\)/)) {
                        joined = joinBrackets;
                        joinBrackets = undefined;
                        ret = name ? { name: name, size: joined.trim() } : { size: joined.trim() };
                        name = undefined;
                        return ret;
                    }

                    return undefined;
                });
            },

            toCamelCase: function (hyphenated) {
                return hyphenated.replace(/-([a-z])/gi, function (s, group) {
                    return group.toUpperCase();
                });
            },

            constructGridAreas: function (rows, columns, selector) {
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

                                definition.spanAreaDefinitions[span[0]][span[1]] = defineArea(left, top, width, height);

                                width = area.width;
                                height = area.height;
                                rowIx = definition.rowSpan;
                                colIx = definition.columnSpan;
                            });

                            definition.area = area;
                            indexedGridTemplateAreas[ix][iix] = definition;

                            if (debug) {
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

                if (debug) {
                    $.map(gridParts, function (definition) {
                        $(definition.object).remove();
                    });
                }
            }
        };
    }());

    models = {
        grid: function (selector) {
            var self;
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

            return {
                rows: [],
                columns: [],
                init: function () {
                    if (self) {
                        return self;
                    }
                    self = this;

                    $(selector).children().each(function (ix, child) {
                        $.each(cssDefs, function (selector) {
                            if ($(child).is(selector)) {
                                ruleHandler.applyRules(selector, $(child));
                            }
                        });
                    });

                    if (debug) {
                        $(selector).addClass('gridDebug');
                    }

                    return self;
                },

                render: function () {
                    var rows = self.rows,
                        columns = self.columns,
                        thisWidth = $(selector).width(),
                        thisHeight = $(selector).height(),
                        rowValues,
                        colValues,
                        fractionalWidth,
                        fractionalHeight,
                        frWidthUnit,
                        frHeightUnit,
                        maxRowIndex = 0,
                        maxColIndex = 0;

                    utils.mapNamedPositionsToIndices(rows, columns);

                    $.map(gridParts, function (part) {
                        maxRowIndex = Math.max(maxRowIndex, part.rowPosition);
                        maxColIndex = Math.max(maxColIndex, part.columnPosition);
                    });

                    utils.padRowsAndColumns(maxRowIndex, maxColIndex, rows, columns);
                    utils.constructIndexedTemplateAreas(rows, columns);

                    $.map(rows, function (row) {
                        row.definePercent(thisHeight);
                    });

                    $.map(columns, function (col) {
                        col.definePercent(thisWidth);
                    });

                    rowValues = aggregatePixelsAndFractions(rows);
                    colValues = aggregatePixelsAndFractions(columns);

                    $(selector).css('min-height', rowValues.pixels);
                    $(selector).css('min-width', colValues.pixels);

                    if (thisHeight < rowValues.pixels) {
                        thisHeight = rowValues.pixels;
                        frHeightUnit = 0;
                    } else {
                        fractionalHeight = thisHeight - rowValues.pixels;
                        frHeightUnit = fractionalHeight / rowValues.fractions;
                    }

                    if (thisWidth < colValues.pixels) {
                        thisWidth = colValues.pixels;
                        frWidthUnit = 0;
                    } else {
                        fractionalWidth = thisWidth - colValues.pixels;
                        frWidthUnit = fractionalWidth / colValues.fractions;
                    }

                    $.map(rows, function (row) {
                        row.defineFraction(frHeightUnit);
                    });

                    $.map(columns, function (col) {
                        col.defineFraction(frWidthUnit);
                    });

                    utils.constructGridAreas(rows, columns, selector);

                    if (!debug) {
                        $.map(gridParts, function (definition) {
                            if (definition.object && definition.object[0]) {
                                var gta = indexedGridTemplateAreas[definition.rowPosition][definition.columnPosition],
                                    area = gta.area,
                                    dummyArea;
                                if (definition.rowSpan !== 1 || definition.columnSpan !== 1) {
                                    area = gta.spanAreaDefinitions[definition.rowSpan][definition.columnSpan];
                                }

                                dummyArea = utils.buildArea(definition, area, selector);
                                dummyArea.append(definition.object);
                                $(selector).append(dummyArea);
                            }
                        });
                    }
                }
            };
        },

        row: function (definition) {

            var type,
                height,
                size = definition.size,
                name = definition.name;

            if (size === "auto") {
                type = "auto";
            } else if (size.match(/(\d+)px/)) {
                type = "px";
                height = size.match(/(\d+)px/)[1];
            } else if (size.match(/(\d*\.?\d+)fr/)) {
                type = "fr";
                height = size.match(/(\d*\.?\d+)fr/)[1];
            } else if (size.match(/(\d*\.?\d+)%/)) {
                type = "%";
                height = size.match(/(\d*\.?\d+)%/)[1];
            }
            height = Number(height);

            return {
                type: type,
                height: height,
                value: height,
                name: name,
                definePercent: function (gridHeight) {
                    if (this.type === "%") {
                        this.height = (this.value * gridHeight / 100);
                    }
                },

                defineFraction: function (frHeightUnit) {
                    if (this.type === "fr") {
                        this.height = (this.value * frHeightUnit);
                    }
                }
            };
        },

        column: function (definition) {

            var type,
                width,
                size = definition.size,
                name = definition.name;

            if (size === "auto") {
                type = "auto";
            } else if (size.match(/(\d+)px/)) {
                type = "px";
                width = size.match(/(\d+)px/)[1];
            } else if (size.match(/(\d*\.?\d+)fr/)) {
                type = "fr";
                width = size.match(/(\d*\.?\d+)fr/)[1];
            } else if (size.match(/(\d*\.?\d+)%/)) {
                type = "%";
                width = size.match(/(\d*\.?\d+)%/)[1];
            }
            width = Number(width);

            return {
                type: type,
                width: width,
                value: width,
                name: name,
                definePercent: function (gridWidth) {
                    if (this.type === "%") {
                        this.width = (this.value * gridWidth / 100);
                    }
                },

                defineFraction: function (frWidthUnit) {
                    if (this.type === "fr") {
                        this.width = (this.value * frWidthUnit);
                    }
                }
            };
        },

        gridComponent: function (object) {
            return {
                object: object,
                name: undefined,
                rowPosition: undefined,
                columnPosition: undefined,
                rowSpan: 1,
                columnSpan: 1,
                leftGridLineName: undefined,
                rightGridLineName: undefined,
                topGridLineName: undefined,
                bottomGridLineName: undefined,
                spans: [],
                spanAreaDefinitions: []
            };
        },

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
        }
    };

    gridRules = {

        gridArea: function (selector, object, value) {
            var name = value.match(/^\"(\w+)\"$/)[1],
                gta,
                parts;

            if (name && namedGridTemplateAreas[name]) {
                gta = namedGridTemplateAreas[name];
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
            var gridComponent = models.getGridComponent(selector, object),
                columnPosition = parseInt(value, 10) - 1;

            if (isFinite(columnPosition)) {
                gridComponent.columnPosition = columnPosition;
            } else {
                gridComponent.leftGridLineName = value.match(/^\"(\w+)\"$/)[1];
            }
        },

        gridColumnSpan: function (selector, object, value) {
            var gridComponent = models.getGridComponent(selector, object),
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
            var columnDefs = utils.splitColumnRowDefinition(value),
                theGrid = models.getGrid(selector);

            theGrid.columns = $.map(columnDefs, function (def) {
                return models.column(def);
            });
        },

        gridDefinitionRows: function (selector, object, value) {
            var rowDefs = utils.splitColumnRowDefinition(value),
                theGrid = models.getGrid(selector);

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
            var gridComponent = models.getGridComponent(selector, object),
                rowPosition = parseInt(value, 10) - 1;

            if (isFinite(rowPosition)) {
                gridComponent.rowPosition = rowPosition;
            } else {
                gridComponent.topGridLineName = value.match(/^\"(\w+)\"$/)[1];
            }
        },

        gridRowSpan: function (selector, object, value) {
            var gridComponent = models.getGridComponent(selector, object),
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
                    gta,
                    rowSpan,
                    colSpan;

                if (!namedGridTemplateAreas[def] && (!indexedGridTemplateAreas[row] || !indexedGridTemplateAreas[row][col])) {
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

                    namedGridTemplateAreas[def] = gta;
                    if (!indexedGridTemplateAreas[row]) {
                        indexedGridTemplateAreas[row] = [];
                    }

                    indexedGridTemplateAreas[row][col] = gta;
                } else if (!namedGridTemplateAreas[def]) {
                    indexedGridTemplateAreas[row][col].name = def;
                    namedGridTemplateAreas[def] = indexedGridTemplateAreas[row][col];
                }
            });
        }
    };

    ruleHandler = (function () {

        function isW3CGrid(rule) {
            if (rule.property === "display") {
                return $.inArray(rule.valueText, gridDisplays) >= 0;
            }
            return gridRules.hasOwnProperty(utils.toCamelCase(rule.property));
        }

        function handleGridRule(selector, object, rule) {
            if (rule.property === "display") {
                object.css("display", rule.valueText.replace('grid', 'block'));
            } else {
                var ruleName = utils.toCamelCase(rule.property);
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

        return {
            applyRules: function (selector, object) {
                var rules = cssDefs[selector].declarations;
                $.map(rules, function (rule) {
                    if (rule instanceof jscsspDeclaration) {
                        applyRule(selector, object, rule);
                    }
                });
                usedCSSDefs.push(selector);
            }
        };
    }());

    $.extend({
        mondrian: function (css) {

            var timeout;

            function renderAll() {
                $.map(grids, function (theGrid) {
                    theGrid.render();
                });
            }

            function delayedRenderAll() {
                if (timeout) {
                    clearTimeout(timeout);
                }
                timeout = setTimeout(renderAll, 10);
            }

            $.map(css.cssRules, function (rule) {
                if (rule instanceof jscsspStyleRule) {
                    cssDefs[rule.mSelectorText] = rule;
                    var display;
                    $.map(rule.declarations, function (declaration) {
                        if (declaration instanceof jscsspDeclaration && declaration.property === "display") {
                            display = declaration.valueText;
                        }
                    });
                    if (display) {
                        ruleHandler.applyRules(rule.mSelectorText, $(rule.mSelectorText));
                    }
                }
            });

            $.map(grids, function (theGrid) {
                theGrid.init();
            });

            $.each(cssDefs, function (selector) {
                if ($.inArray(selector, usedCSSDefs) < 0) {
                    ruleHandler.applyRules(selector, $(selector));
                }
            });

            window.onresize = delayedRenderAll;
            renderAll();
        }
    });

    $.map(scripts, function (script) {
        if (script.getAttribute('data-stylesheet')) {
            cssFile = script.getAttribute('data-stylesheet');
        }
        return cssFile;
    });

    if (cssFile) {
        $.get(cssFile, function (data) {
            var parser = new CSSParser(),
                sheet = parser.parse(data, false, true);

            $.mondrian(sheet);
        });
    }
}(jQuery));