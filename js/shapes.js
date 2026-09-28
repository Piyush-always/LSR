// js/shapes.js

export const SHAPES = {

    rectangle: {
        id: "rectangle",
        name: "Rectangle",

        width: 72,
        height: 35,

        cornerRadius: 4,

        hole: {
            x: 8,
            y: 8,
            radius: 3
        }
    },

    circle: {
        id: "circle",
        name: "Circle",

        diameter: 50,

        hole: {
            x: 9,
            y: 9,
            radius: 3
        }
    },

    heart: {
        id: "heart",
        name: "Heart",

        width: 55,
        height: 50,

        hole: {
            x: 9,
            y: 8,
            radius: 3
        }
    }

};

export let currentShape = SHAPES.rectangle;

export function setShape(id) {

    if (SHAPES[id]) {
        currentShape = SHAPES[id];
    }

    return currentShape;

}