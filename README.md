mondrian
========

A javascript implementation of the W3C Grid Layout specification.

v. 0.0.1:
 - support for display: grid / inline-grid on a single element
 - grid-template CSS definition, and mapping to grid-area definitions
 - grid-definitions-rows / grid-definition-columns support for pixel, % and fr values
 - grid-position, grid-row-position, grid-column-position CSS definitions
 - grid-span, grid-row-span, grid-column-span CSS definitions
 - grid-row, grid-column CSS definitions

Not yet supported:
 - multiple grids on a page
 - auto-sizing of regions
 - minmax on sizing
 - named grid lines
 - row/column span > 1 on elements with a grid-area definition
 - repeat() in grid-definition-rows / grid-definition-columns
 - probably more