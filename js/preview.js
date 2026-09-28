// js/preview.js

import { currentShape } from "./shapes.js";

const SVG_NS = "http://www.w3.org/2000/svg";

export function renderPreview(svg) {

    console.log("Rendering:", currentShape.id);

    while (svg.firstChild) {
        svg.removeChild(svg.firstChild);
    }

    // Keep a consistent coordinate system
    svg.setAttribute("viewBox", "0 0 100 100");

    // Center everything
    const group = document.createElementNS(SVG_NS, "g");
    group.setAttribute("transform", "translate(50 50)");
    svg.appendChild(group);

    switch (currentShape.id) {

        case "rectangle":
            drawRectangle(group);
            break;

        case "circle":
            drawCircle(group);
            break;

        case "heart":
            drawHeart(group);
            break;
    }
}

export function renderShapeOverlay(svg) {

    console.log("Overlay:", currentShape.id);

    while (svg.firstChild) {
        svg.removeChild(svg.firstChild);
    }

    svg.setAttribute("viewBox", "0 0 100 100");

    const group = document.createElementNS(SVG_NS, "g");
    group.setAttribute("transform", "translate(50 50)");

    svg.appendChild(group);

    switch (currentShape.id) {

        case "rectangle":
            drawRectangle(group);
            break;

        case "circle":
            drawCircle(group);
            break;

        case "heart":
            drawHeart(group);
            break;

    }

}

export function getRectanglePath() {
    return `
        M -36 -18
        H 36
        Q 41 -18 41 -13
        V 13
        Q 41 18 36 18
        H -36
        Q -41 18 -41 13
        V -13
        Q -41 -18 -36 -18
        Z
    `;
}

export function getCirclePath() {
    return `
        M 28 0
        A 28 28 0 1 1 -28 0
        A 28 28 0 1 1 28 0
        Z
    `;
}

export function getHeartPath() {
    return `
        M 0 26
        L -24 -2
        C -34 -16 -28 -34 -12 -34
        C -4 -34 0 -26 0 -26
        C 0 -26 4 -34 12 -34
        C 28 -34 34 -16 24 -2
        Z
    `;
}

function drawRectangle(group) {

    const path = document.createElementNS(SVG_NS, "path");

    path.setAttribute("d", getRectanglePath());

    styleShape(path);

    group.appendChild(path);

    drawHole(group, -28, -10);
}

function drawCircle(group) {

    const path = document.createElementNS(SVG_NS, "path");

    path.setAttribute("d", getCirclePath());

    styleShape(path);

    group.appendChild(path);

    drawHole(group, -18, -18);
}

function drawHeart(group) {

    const path = document.createElementNS(SVG_NS, "path");

    path.setAttribute("d", getHeartPath());

    styleShape(path);

    group.appendChild(path);

    drawHole(group, -16, -24);
}

function drawHole(group, x, y) {

    const hole = document.createElementNS(SVG_NS, "circle");

    hole.setAttribute("cx", x);
    hole.setAttribute("cy", y);
    hole.setAttribute("r", 3);

    hole.setAttribute("fill", "#fff");
    hole.setAttribute("stroke", "#111");
    hole.setAttribute("stroke-width", "2");

    group.appendChild(hole);
}

function styleShape(element) {

    element.setAttribute("fill", "#ffffff");
    element.setAttribute("stroke", "#111");
    element.setAttribute("stroke-width", "2");
    element.setAttribute("stroke-linejoin", "round");
    element.setAttribute("stroke-linecap", "round");
}