window.KEYCHAIN_SHAPES = {

    rectangle: {
        outline: `
            <rect
                x="2"
                y="2"
                width="68"
                height="31"
                rx="4"
                ry="4"
            />
        `,
        hole: `
            <circle
                cx="7"
                cy="17.5"
                r="2.5"
            />
        `
    },

    circle: {
        outline: `
            <circle
                cx="36"
                cy="17.5"
                r="15.5"
            />
        `,
        hole: `
            <circle
                cx="36"
                cy="4.5"
                r="2.5"
            />
        `
    },

    heart: {
        outline: `
            <path
                d="M36 30
                   C20 20 16 14 16 9
                   C16 5 19 2 23 2
                   C28 2 32 6 36 10
                   C40 6 44 2 49 2
                   C53 2 56 5 56 9
                   C56 14 52 20 36 30"
            />
        `,
        hole: `
            <circle
                cx="36"
                cy="4"
                r="2.5"
            />
        `
    }

};