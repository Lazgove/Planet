import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { GUI } from 'lil-gui';
import { createNoise3D } from 'https://cdn.skypack.dev/simplex-noise';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// main.js
import { cloner, loadAssets, bakeTerrain, createStars, createCircleTexture, reduceMeshComplexity } from './utilities.js';
const clock = new THREE.Clock();

const params = {
    heat: 0.5,
    season: 'Summer',
    waterLevel: 1.0,
    windLevel: 0.2,
    earthquakeLevel: 0.0,
    // Helper to trigger a new bake
    regenerate: () => { 
        bakeTerrain(planet, params); 
        // Re-save original positions after bake if you are animating
        planet.geometry.userData.originalPositions = new Float32Array(planet.geometry.attributes.position.array);
    }
};

const materials = {
    Ocean: createSphericalGradientMaterial(0x0044aa, 0x0099ff, 4.5, 5.0, {
        transmission: 0.0,
        ior: 1.33,
        roughness: 0.1
    }),
    Land: createSphericalGradientMaterial(0xecca5b, 0x91a02e, 12, 12.5, {
        roughness: 0.8
    }),
    Mountains: createSphericalGradientMaterial(0x6e3f13, 0xffffff, 12, 16, {
        roughness: 0.9
    }),
    Sand: createSphericalGradientMaterial(0xd2b48c, 0xfff4e0, 4.9, 5.1, {
        roughness: 1.0
    })
};

function createSphericalGradientMaterial(innerColor, outerColor, innerRadius, outerRadius, params = {}) {
    const mat = new THREE.MeshPhysicalMaterial({
        ...params,
        flatShading: true
    });

    mat.userData.gradient = {
        colorInner: new THREE.Color(innerColor),
        colorOuter: new THREE.Color(outerColor),
        innerRadius: innerRadius,
        outerRadius: outerRadius
    };

    mat.onBeforeCompile = (shader) => {
        shader.uniforms.uColorInner = { value: mat.userData.gradient.colorInner };
        shader.uniforms.uColorOuter = { value: mat.userData.gradient.colorOuter };
        shader.uniforms.uInnerRadius = { value: mat.userData.gradient.innerRadius };
        shader.uniforms.uOuterRadius = { value: mat.userData.gradient.outerRadius };

        // 1. Pass the distance from center to the fragment shader
        shader.vertexShader = `
            varying float vDist;
        ` + shader.vertexShader;

        shader.vertexShader = shader.vertexShader.replace(
            `#include <begin_vertex>`,
            `#include <begin_vertex>
            // Calculate distance from local origin (0,0,0)
            vDist = length(position);` 
        );

        // 2. Mix colors based on that distance
        shader.fragmentShader = `
            uniform vec3 uColorInner;
            uniform vec3 uColorOuter;
            uniform float uInnerRadius;
            uniform float uOuterRadius;
            varying float vDist;
        ` + shader.fragmentShader;

        shader.fragmentShader = shader.fragmentShader.replace(
            `vec4 diffuseColor = vec4( diffuse, opacity );`,
            `
            // Map distance to a 0-1 factor
            float factor = clamp((vDist - uInnerRadius) / (uOuterRadius - uInnerRadius), 0.0, 1.0);
            vec3 finalColor = mix(uColorInner, uColorOuter, factor);
            vec4 diffuseColor = vec4( finalColor, opacity );
            `
        );
    };

    return mat;
}

// --- CONFIGURATION ---
let scene, camera, renderer, controls, planet, ocean, mountains, sand, atmosphere, material;

async function init() {
    setupScene(); // Your renderer/camera setup
    setupLights(); // Your light setup
    setupGUI();

    planet = new THREE.Mesh(
        new THREE.IcosahedronGeometry(12, 50),
        materials['Land']
    );

    const paramsPlanet = { 
        scale: 0.05, 
        octaves: 4, 
        persistence: 0.5, 
        lacunarity: 2.0, 
        amplitude: 4 
    }

    ocean = new THREE.Mesh(
        new THREE.IcosahedronGeometry(12, 50),
        materials['Ocean']
    );

    const paramsOcean = { 
        scale: 0.05, 
        octaves: 10, 
        persistence: 0.5, 
        lacunarity: 2.0, 
        amplitude: 0.5 
    }

    mountains = new THREE.Mesh(
        new THREE.IcosahedronGeometry(12, 50),
        materials['Mountains']
    );

    const paramsMountains = { 
        scale: 0.1, 
        octaves: 7, 
        persistence: 0.5, 
        lacunarity: 2.0, 
        amplitude: 6 
    }

    sand = new THREE.Mesh(
        new THREE.IcosahedronGeometry(11.2, 50),
        materials['Sand']
    );

    const paramsSand = { 
        scale: 0.05, 
        octaves: 7, 
        persistence: 0.5, 
        lacunarity: 2.0, 
        amplitude: 0.5 
    }


    //planet.material.wireframe = true;
    atmosphere = new THREE.Mesh(
        new THREE.IcosahedronGeometry(20, 10),
    );

    atmosphere.visible = false;
    scene.add(atmosphere);

    // Applying it to your 4 layers
    const myLayers = [planet, ocean, mountains];
    myLayers.forEach(layer => reduceMeshComplexity(layer, 0.6)); // Reduce by 60%

    bakeTerrain(planet, paramsPlanet);
    scene.add(planet);

    bakeTerrain(ocean, paramsOcean);
    scene.add(ocean);

    bakeTerrain(mountains, paramsMountains);
    scene.add(mountains);

    bakeTerrain(sand, paramsSand);
    scene.add(sand);
    // ... after bakeTerrain and reduction ...
    const originalArray = ocean.geometry.attributes.position.array;
    ocean.geometry.userData.originalPositions = new Float32Array(originalArray);
    const starTexture = createCircleTexture(); // No loader needed!
    const stars = createStars(2000, 50, starTexture);
    scene.add(stars);

    // 2. Define and Load Assets
    const natureItems = {
        pine: 'assets/models/pine.glb',
        tree_1: 'assets/models/tree_1.glb',
        tree_2: 'assets/models/tree_2.glb',
    };

    const spaceItems = {
        satellite: 'assets/models/satellite.glb',
    };

    try {

        const [nature, space] = await Promise.all([
            loadAssets(natureItems),
            loadAssets(spaceItems),
        ]);

        //const natureClones = cloner(planet, 50, Object.values(nature), scene, 1, true, false, false);
        const spaceClones = cloner(atmosphere, 20, Object.values(space), scene, 20, true, true, true);

        //console.log(`Successfully placed ${natureClones} trees.`);
        console.log(`Successfully placed ${spaceClones} satellite.`);
    } catch (e) {
        console.error("Loading failed", e);
    }

    animate(planet);
}

function animate() {

    // Constant rotation on the Y-axis (Vertical axis)
    // Adjust 0.1 to change the speed
    const delta = clock.getDelta(); 
    //planet.rotation.y += delta * 0.2; 
    //planetCrust.rotation.y += delta * 0.2; 
    const time = performance.now() * 0.001; // Get time in seconds

    // Call your water animation
    animateWater(ocean, time);
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
}

function setupScene() {
    // 1. Create the Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050505); // Very dark gray/black

    // 2. Setup Camera (Field of View, Aspect Ratio, Near, Far)
    const aspect = window.innerWidth / window.innerHeight;
    camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);
    camera.position.z = 5; // Move camera back to see the planet

    // 3. Setup Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    
    // Enable shadows for depth
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // --- ADD ORBITCONTROLS HERE ---
    controls = new OrbitControls(camera, renderer.domElement);
    
    // Optional: Add some "weight" to the movement
    controls.enableDamping = true; 
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = false;
    controls.minDistance = 3;  // Don't zoom inside the planet
    controls.maxDistance = 100; // Don't zoom too far away

    document.body.appendChild(renderer.domElement);

    // Handle Window Resize
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}

function setupLights() {

    const rgbeLoader = new RGBELoader();
    rgbeLoader.load('/assets/HDRI_space.hdr', (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;

        // Use the HDRI for the background
        scene.background = texture;

        // Use the HDRI for realistic lighting/reflections on materials
        scene.environment = texture;
    });

    // 1. Ambient Light: Softly illuminates everything
    const ambientLight = new THREE.AmbientLight(0xffffff, 1);
    scene.add(ambientLight);

    // 2. Directional Light: Acts like the Sun
    const sunLight = new THREE.DirectionalLight(0xffff70, 5);
    sunLight.position.set(5, 3, 5); // Positioned to one side
    
    // Setup Shadows for the Sun
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 1024;
    sunLight.shadow.mapSize.height = 1024;
    
    scene.add(sunLight);

    // 3. Point Light (Optional): Adds a "glow" near the planet
    const glowLight = new THREE.PointLight(0x00ff88, 0.5);
    glowLight.position.set(-2, -2, 2);
    scene.add(glowLight);
}

function setupGUI() {

    const gui = new GUI({ title: 'Planet Settings' });

    // Sliders: (object, property, min, max, step)
    gui.add(params, 'heat', 0, 1).name('Heat / Aridity');

    // Dropdown: (object, property, options array)
    gui.add(params, 'season', ['Spring', 'Summer', 'Autumn', 'Winter']).name('Season');

    gui.add(params, 'waterLevel', 0.8, 1.2).name('Ocean Level').onChange((val) => {
        oceanMesh.scale.setScalar(val); // Resize ocean sphere instantly
    });

    gui.add(params, 'windLevel', 0, 1).name('Wind Intensity');

    gui.add(params, 'earthquakeLevel', 0, 0.5).name('Tectonic Shift');

    // Button to trigger a rebuild
    gui.add(params, 'regenerate').name('Apply Changes');
}

function animateWater(oceanMesh, time) {
    const posAttr = oceanMesh.geometry.attributes.position;
    const original = oceanMesh.geometry.userData.originalPositions;
    
    const vertex = new THREE.Vector3();
    const dir = new THREE.Vector3();

    for (let i = 0; i < posAttr.count; i++) {
        // Read the original baked position
        vertex.set(original[i * 3], original[i * 3 + 1], original[i * 3 + 2]);
        
        // Direction from center (for a sphere)
        dir.copy(vertex).normalize();

        // Wave math: Adjust scale (1.5) and speed (2.0) as needed
        const wave = Math.sin(time * 2.0 + vertex.x * 1.5 + vertex.y * 1.5) * 0.015;
        
        // Push the vertex out/in along its normal
        vertex.add(dir.multiplyScalar(wave));

        // Update the attribute
        posAttr.setXYZ(i, vertex.x, vertex.y, vertex.z);
    }

    // Tell Three.js the positions changed
    posAttr.needsUpdate = true;
    
    // Since it's low poly, we MUST recompute normals every frame 
    // so the light "flat shades" the moving facets correctly
    oceanMesh.geometry.computeVertexNormals();
}

init();

