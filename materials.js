// 1. Define your 4 colors
const colorOcean = new THREE.Color(0x008080); // Turquoise
const colorSand  = new THREE.Color(0xd2b48c); // Sand
const colorLand  = new THREE.Color(0x91a02e); // Green-Yellow
const colorMt    = new THREE.Color(0xeeeeee); // Grey-White

const planetMaterial = new THREE.ShaderMaterial({
    uniforms: {
        uOcean: { value: colorOcean },
        uSand:  { value: colorSand },
        uLand:  { value: colorLand },
        uMt:    { value: colorMt },
    },
    vertexShader: `
        varying float vHeight;
        void main() {
            vHeight = position.y; // Pass the height to the fragment shader
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform vec3 uOcean, uSand, uLand, uMt;
        varying float vHeight;
        void main() {
            // Normalize vHeight or use specific thresholds
            float h = vHeight; 
            vec3 finalColor;

            if (h < -0.2) {
                finalColor = mix(uOcean, uSand, smoothstep(-0.5, -0.2, h));
            } else if (h < 0.2) {
                finalColor = mix(uSand, uLand, smoothstep(-0.2, 0.2, h));
            } else {
                finalColor = mix(uLand, uMt, smoothstep(0.2, 0.5, h));
            }

            gl_FragColor = vec4(finalColor, 1.0);
        }
    `,
    transparent: true,
    opacity: 0.9
});