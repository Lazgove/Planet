import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createNoise3D } from 'simplex-noise';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SimplifyModifier } from 'three/examples/jsm/modifiers/SimplifyModifier.js';

/**
 * @param {THREE.Mesh} planet - The sphere mesh to place objects on
 * @param {number} count - Number of clones
 * @param {THREE.Object3D[]} prefabs - Array of loaded models
 * @param {THREE.Scene} scene - The scene to add clones to
 */
const noise3D = createNoise3D();

export function cloner(planet, count, prefabs, scene, size=1, scaleRand=false, rotationRand=false, positionRand=false) {
    planet.updateMatrixWorld();

    const positions = planet.geometry.attributes.position;
    const totalVertices = positions.count;
    const actualCount = Math.min(count, totalVertices);
    
    const usedIndices = new Set();
    const clones = [];

    // Displacement Range (Adjust these values)
    const dispAmount = 0.5; 

    for (let i = 0; i < actualCount; i++) {
        let vIndex;
        do {
            vIndex = Math.floor(Math.random() * totalVertices);
        } while (usedIndices.has(vIndex));
        usedIndices.add(vIndex);

        const randomPrefab = prefabs[Math.floor(Math.random() * prefabs.length)];
        const clone = randomPrefab.clone();

        if (scaleRand) {
            // 1. Randomized Scale
            const minScale = 0.001*size;
            const maxScale = 0.002*size;
            const randomScale = Math.random() * (maxScale - minScale) + minScale;
            clone.scale.setScalar(randomScale);
        }

        // 2. Initial Positioning
        const vertex = new THREE.Vector3();
        vertex.fromBufferAttribute(positions, vIndex);
        vertex.applyMatrix4(planet.matrixWorld); 
        clone.position.copy(vertex);

        // 3. Align to surface normal
        const normal = vertex.clone().sub(planet.position).normalize();
        clone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);

        if (rotationRand) {
            clone.rotateX(Math.random() * Math.PI * 2);
            clone.rotateY(Math.random() * Math.PI * 2);
            clone.rotateZ(Math.random() * Math.PI * 2);
        }

        // --- NEW: Randomized Displacement ---
        // This shifts the clone slightly on its local X and Z (sliding it on the surface)
        // and optionally Y (sinking it into or lifting it off the ground).

        if (positionRand) {
            const offsetX = (Math.random() - 0.5) * dispAmount;
            const offsetY = (Math.random() - 0.5) * dispAmount; // Smaller Y jitter
            const offsetZ = (Math.random() - 0.5) * dispAmount;
            clone.translateX(offsetX);
            clone.translateY(offsetY);
            clone.translateZ(offsetZ);
        }

        scene.add(clone);
        clones.push(clone);
    }
    return clones;
}

export async function loadAssets(assetsObj) {
    const gltfLoader = new GLTFLoader();
    const textureLoader = new THREE.TextureLoader();
    const loadedAssets = {};

    const assetPromises = Object.entries(assetsObj).map(async ([name, url]) => {
        if (url.endsWith('.glb') || url.endsWith('.gltf')) {
            const result = await gltfLoader.loadAsync(url);
            
            // Ensure every part of the model is shadow-ready
            result.scene.traverse((node) => {
                if (node.isMesh) {
                    node.castShadow = true;
                    node.receiveShadow = true;
                }
            });
            loadedAssets[name] = result.scene;
        } else if (url.endsWith('.png') || url.endsWith('.jpg')) {
            const texture = await textureLoader.loadAsync(url);
            loadedAssets[name] = texture;
        }
    });

    await Promise.all(assetPromises);
    return loadedAssets;
}

/**
 * Displaces a planet mesh to create high mountains and flat lowlands.
 * @param {THREE.Mesh} planet - The mesh to displace.
 * @param {Function} noise3D - Your 3D noise function (returns -1 to 1).
 */

export function bakeTerrain(planet, params = { 
    scale: 0.05, 
    octaves: 4, 
    persistence: 0.5, 
    lacunarity: 2.0, 
    amplitude: 4 
}) {
    const posAttr = planet.geometry.attributes.position;
    const vertex = new THREE.Vector3();
    const dir = new THREE.Vector3();

    for (let i = 0; i < posAttr.count; i++) {
        vertex.fromBufferAttribute(posAttr, i);
        dir.copy(vertex).normalize();

        // --- 1. SIMPLE FBM NOISE ---
        let noiseValue = 0;
        let frequency = params.scale;
        let amplitude = 1.0;
        let maxValue = 0; // Used for normalizing result

        for (let o = 0; o < params.octaves; o++) {
            // noise3D usually returns -1 to 1
            const n = noise3D(
                vertex.x * frequency, 
                vertex.y * frequency, 
                vertex.z * frequency
            );
            
            noiseValue += n * amplitude;
            maxValue += amplitude;
            
            amplitude *= params.persistence;  // Usually 0.5 (smaller each step)
            frequency *= params.lacunarity;   // Usually 2.0 (tighter each step)
        }

        // Normalize to 0-1 range
        const finalHeight = (noiseValue / maxValue) * params.amplitude;

        // --- 2. APPLY ---
        vertex.add(dir.multiplyScalar(finalHeight));
        posAttr.setXYZ(i, vertex.x, vertex.y, vertex.z);
        console.log("finish");
    }

    // IMPORTANT: Polygon reduction works best on indexed geometry. 
    // If you want "Flat Shading" (C4D look), do it AFTER reduction.
    posAttr.needsUpdate = true;
    planet.geometry.computeVertexNormals();
    planet.geometry = BufferGeometryUtils.mergeVertices(planet.geometry);
    // D. Apply a Flat Material
    planet.material.flatShading = true;
    planet.material.needsUpdate = true;

}

export function createStars(count, radius, texture) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);

    // Define your palette
    const palette = [
        new THREE.Color(0xffffff), // Pure White
        new THREE.Color(0xfff5e1), // Pale Yellow (Cream)
        new THREE.Color(0xffd700), // Golden Yellow
        new THREE.Color(0xffa570), // Pale Yellow-Red (Peach/Sunset)
        new THREE.Color(0xffd2a1)  // Warm White
    ];

    for (let i = 0; i < count; i++) {
        const i3 = i * 3;

        // 1. Position (Spherical distribution)
        const d = new THREE.Vector3(
            Math.random() - 0.5,
            Math.random() - 0.5,
            Math.random() - 0.5
        ).normalize().multiplyScalar(radius + (Math.random() * 100));
        
        positions[i3] = d.x;
        positions[i3+1] = d.y;
        positions[i3+2] = d.z;

        // 2. Color & Intensity Variation
        // Pick a random color from palette and multiply by a random intensity
        const baseColor = palette[Math.floor(Math.random() * palette.length)];
        const intensity = 0.5 + Math.random() * 2.0; // Random brightness boost
        
        colors[i3] = baseColor.r * intensity;
        colors[i3+1] = baseColor.g * intensity;
        colors[i3+2] = baseColor.b * intensity;

        // 3. Size Variation
        sizes[i] = Math.random() * 2.0; 
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
        size: 1.0, 
        map: texture,
        vertexColors: true,     // Use the colors we created above
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true
    });

    return new THREE.Points(geometry, material);
}

export function createCircleTexture() {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');

    // Create a radial gradient (Inner white to outer transparent)
    const gradient = context.createRadialGradient(
        size / 2, size / 2, 0,
        size / 2, size / 2, size / 2
    );
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.2, 'rgba(255,255,255,0.8)');
    gradient.addColorStop(0.5, 'rgba(255,255,255,0.2)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');

    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);

    const texture = new THREE.CanvasTexture(canvas);
    return texture;
}

const modifier = new SimplifyModifier();

export function reduceMeshComplexity(mesh, reductionRatio = 0.5) {
    // 1. Ensure the geometry is indexed and vertices are merged.
    // This is crucial! Without this, the reduction will create holes.
    let geometry = mesh.geometry;
    if (!geometry.index) {
        geometry = BufferGeometryUtils.mergeVertices(geometry);
    }

    // 2. Calculate the target number of vertices to remove
    const initialCount = geometry.attributes.position.count;
    const countToRemove = Math.floor(initialCount * reductionRatio);

    // 3. Apply the simplification
    try {
        const simplified = modifier.modify(geometry, countToRemove);
        
        // 4. Recompute normals so the shading looks correct (C4D does this automatically)
        simplified.computeVertexNormals();
        
        mesh.geometry = simplified;
        console.log(`Reduced from ${initialCount} to ${simplified.attributes.position.count} vertices.`);
    } catch (error) {
        console.error("Simplification failed for this mesh:", error);
    }
}