import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { GUI } from 'three/addons/libs/lil-gui.module.min.js'; // Add this line
import { createNoise3D } from 'https://cdn.skypack.dev/simplex-noise';

// Initialize the noise function
const noise3D = createNoise3D();

// --- CONFIGURATION ---
let scene, camera, renderer, controls, planet;
const PLANET_RADIUS = 10;

// Inside your main class or init
const clones = [];
const vertexIndices = []; // Stores which vertex each building belongs to
let originalPositions;

// Global settings object
const settings = {
    audioVolume: 0.5,
    planetColor: 0x228b22,
    wireframe: false,
    speed: 1.0,
    count: 50
};

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2(0, 0); // Center of the screen
let impactPoint = new THREE.Vector3();

const planetVertexShader = `
    attribute float aBakedHeight; // Our new locked data
    varying float vLockedHeight;

    void main() {
        vLockedHeight = aBakedHeight; // Pass it to the fragment shader
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const planetFragmentShader = `
    varying float vLockedHeight;

    void main() {
        // 1. Base Colors (keep them punchy for low-poly)
        vec3 ocean = vec3(0.1, 0.3, 0.6);
        vec3 sand  = vec3(0.9, 0.8, 0.5);
        vec3 grass = vec3(0.3, 0.6, 0.2);
        vec3 rock  = vec3(0.5, 0.5, 0.5);
        vec3 snow  = vec3(1.0, 1.0, 1.0);

        // 2. HARD CUTS (No more smoothstep blending)
        // We use a simple if/else or step() to ensure no gradients
        vec3 finalColor;
        if (vLockedHeight < 10.2) {
            finalColor = ocean;
        } else if (vLockedHeight < 10.5) {
            finalColor = sand;
        } else if (vLockedHeight < 11.2) {
            finalColor = grass;
        } else if (vLockedHeight < 12.0) {
            finalColor = rock;
        } else {
            finalColor = snow;
        }

        gl_FragColor = vec4(finalColor, 1.0);
    }
`;


function init() {

    // 1. Scene & Camera
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 10, 15);

    // 2. Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0; // Adjust this number to brighten/darken
    document.body.appendChild(renderer.domElement);

    // 3. Orbit Controls (Zoom & Rotate)
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    // // 4. HDRI
    // const loader = new RGBELoader();
    // loader.setPath('./assets/'); // Path relative to your main.js
    // loader.load('HDRI_space.hdr', function (texture) {
        
    //     // Mapping the texture for 360 environment
    //     texture.mapping = THREE.EquirectangularReflectionMapping;

    //     // Set the scene background
    //     scene.background = texture;
        
    //     // Set the scene environment (this makes buildings reflect the sky)
    //     scene.environment = texture;

    //     console.log("HDRI Loaded Successfully");
    // });

    // 5. Lights
    const sun = new THREE.DirectionalLight(0xffffff, 2.5);
    const ambient = new THREE.AmbientLight(0x202040, 0.8);
    sun.position.set(10, 10, 10);
    scene.add(sun);
    scene.add(ambient);

    // 6. The Tiny Planet
    const planetGeo = new THREE.SphereGeometry(PLANET_RADIUS, 32, 24);
    const lowPolyGeo = planetGeo.toNonIndexed(); 
    planet = new THREE.Mesh(planetGeo);
    scene.add(planet);
    bakeTerrain();
    lockColors();
    
    const planetMat = new THREE.ShaderMaterial({
    vertexShader: planetVertexShader,
    fragmentShader: planetFragmentShader
    });

    planet.material = planetMat;
    //createPlanetLayout(planet);

    const gui = new GUI();
    // Add a slider (Min: 0, Max: 5, Step: 0.01)
    gui.add(settings, 'audioVolume', 0, 5, 0.01).name('Displacement Strength');
    // Add a speed control
    gui.add(settings, 'speed', 0, 10).name('Animation Speed');
    // Add a toggle for wireframe (great for debugging displacement!)
    gui.add(settings, 'wireframe').name('Show Mesh').onChange(value => {
        planet.material.wireframe = value;
    });
    // Add to your GUI section in init()
    gui.add(settings, 'count', 1, 500, 1)
        .name('Clone Count')
        .onFinishChange(() => {
            refreshClones();
    });

    // Add a color picker
    gui.addColor(settings, 'planetColor').name('Planet Color').onChange(value => {
        planet.material.color.set(value);
    });

    setupCloner(20);

    animate();
}

function lockColors() {
    const count = planet.geometry.attributes.position.count;
    // Create a new array to hold the "baked" heights
    const bakedHeights = new Float32Array(count);
    const posAttr = planet.geometry.attributes.position;
    const vertex = new THREE.Vector3();

    for (let i = 0; i < count; i++) {
        vertex.fromBufferAttribute(posAttr, i);
        // Store the distance from center BEFORE any earthquakes happen
        bakedHeights[i] = vertex.length(); 
    }

    // Add this as a new attribute to the geometry
    planet.geometry.setAttribute('aBakedHeight', new THREE.BufferAttribute(bakedHeights, 1));
}

function bakeTerrain() {
    const posAttr = planet.geometry.attributes.position;
    const vertex = new THREE.Vector3();

    for (let i = 0; i < posAttr.count; i++) {
        vertex.fromBufferAttribute(posAttr, i);

        // Sampling noise using the new imported function
        // We use coordinates / scale to get smooth features
        let noise = noise3D(vertex.x * 0.1, vertex.y * 0.1, vertex.z * 0.1) * 1.2;
        noise += noise3D(vertex.x * 0.4, vertex.y * 0.4, vertex.z * 0.4) * 0.3;

        // Apply to geometry
        const direction = vertex.clone().normalize();
        if (noise < 0) noise *= 0.1; // Shallow oceans
        
        vertex.add(direction.multiplyScalar(noise));
        posAttr.setXYZ(i, vertex.x, vertex.y, vertex.z);
    }

    posAttr.needsUpdate = true;
    planet.geometry.computeVertexNormals();

    // Update the reference for buildings and earthquakes
    originalPositions = planet.geometry.attributes.position.array.slice();
}

function refreshClones() {
    // 1. Remove old buildings from the Three.js scene
    clones.forEach(building => {
        scene.remove(building);
        building.geometry.dispose(); // Clean up memory
        building.material.dispose();
    });

    // 2. Empty the arrays
    clones.length = 0;
    vertexIndices.length = 0;

    // 3. Run the setup again with the new number
    setupCloner(settings.count);
}

function updateDisplacer(time, audioVolume) {
    updateRaycast(); // Find where the earthquake starts

    const posAttr = planet.geometry.attributes.position;
    const vertex = new THREE.Vector3();
    
    // UI Settings (Add these to your lil-gui)
    const frequency = 2.0; 
    const falloffRadius = 15.0; // How far the earthquake travels

    for (let i = 0; i < posAttr.count; i++) {
        // Get Original Position
        vertex.set(
            originalPositions[i * 3],
            originalPositions[i * 3 + 1],
            originalPositions[i * 3 + 2]
        );

        // 1. Calculate Distance from Impact Point
        const dist = vertex.distanceTo(impactPoint);

        // 2. Calculate Falloff (Linear or Exponential)
        // If distance is greater than falloffRadius, factor is 0
        let falloff = Math.max(0, 1 - dist / falloffRadius);
        falloff = Math.pow(falloff, 2); // Sharper falloff curve

        // 3. Rayleigh Wave Simulation (Sine Wave)
        const wave = Math.sin(dist * frequency - time * 5) * audioVolume * falloff;

        // 4. Displace along Normal
        const direction = vertex.clone().normalize();
        vertex.add(direction.multiplyScalar(wave));

        posAttr.setXYZ(i, vertex.x, vertex.y, vertex.z);
    }
    
    posAttr.needsUpdate = true;
    planet.geometry.computeVertexNormals();
}

function setupCloner(count) {
    const buildingGeo = new THREE.BoxGeometry(0.2, 1, 0.2);
    const buildingMat = new THREE.MeshStandardMaterial({ color: 0x666666 });

    for (let i = 0; i < count; i++) {
        const building = new THREE.Mesh(buildingGeo, buildingMat);
        
        // Pick a random vertex index from the sphere
        const vIndex = Math.floor(Math.random() * (planet.geometry.attributes.position.count));
        vertexIndices.push(vIndex);
        
        scene.add(building);
        clones.push(building);
    }
}

function updateClones() {
    const planetPosAttr = planet.geometry.attributes.position;
    const tempPos = new THREE.Vector3();

    clones.forEach((building, i) => {
        const vIndex = vertexIndices[i];
        
        // Get the current (displaced) position of the vertex
        tempPos.fromBufferAttribute(planetPosAttr, vIndex);
        
        // Update Building Position
        building.position.copy(tempPos);

        // Update Building Rotation (keep it pointing "up" from the surface)
        const normal = tempPos.clone().normalize();
        building.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
    });
}

function checkDestruction(volume) {
    clones.forEach((building, i) => {
        if (volume > 0.8) { // If the earthquake is too strong
            building.userData.isBroken = true;
        }

        if (building.userData.isBroken) {
            console.log(volume);
            building.rotation.x += 20; // Falling over
            building.position.y -= 0.05; // Sinking
        }
    });
}

function updateRaycast() {
    // Cast a ray from the center of the camera
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(planet);

    if (intersects.length > 0) {
        impactPoint.copy(intersects[0].point);
    }
}

function animate() {
    requestAnimationFrame(animate);

    // Use speed from UI
    const time = performance.now() * 0.001 * settings.speed; 

    // if (analyzer) {
    //     analyzer.getByteFrequencyData(dataArray);
    //     audioVolume = dataArray[10] / 255; // Use a specific frequency bin
    // }

    // 3. THE DISPLACER: Deform the planet geometry
    updateDisplacer(time, settings.audioVolume, originalPositions);

    // 4. THE CLONER: Make buildings follow the new vertex positions
    updateClones();
    //checkDestruction(settings.audioVolume);

    // 5. Update OrbitControls and Render
    controls.update();
    renderer.render(scene, camera);
}

// Start only after user interaction
document.getElementById('overlay').addEventListener('click', () => {
    document.getElementById('overlay').style.display = 'none';
    init();
    // Here is where you would call your initAudio() function
});

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});