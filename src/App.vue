<template>
	<div id="map"></div>
	<div class="overlay top left flex-col gap">
		<Logo class="mb-2" />
		<div v-if="!state.started">
			<h4 class="select mb-2">{{ select }}</h4>
			<div class="flex gap">
				<Button @click="selectAll" class="bg-success" text="Select all countries" title="Select all countries" />
				<Button v-if="selected.length" @click="deselectAll" class="bg-danger" text="Deselect all" title="Deselect all" />
			</div>
		</div>

		<div v-if="selected.length" class="selected">
			<h4 class="center mb-2">Countries/Territories ({{ selected.length }})</h4>
			<Checkbox v-model:checked="settings.markersOnImport" label="Add markers to imported locations" title="This may affect performance." />
			<div v-for="country of selected" class="line flex space-between">
				<div class="flex-center">
					<span v-if="country.feature.properties.code" :class="`flag-icon flag-` + country.feature.properties.code.toLowerCase()"></span>
					{{ getName(country) }}
					<Spinner v-if="state.started && country.isProcessing" class="ml-2" />
				</div>
				<label class="smallbtn bg-success"><input type="file" @change="locationsFileProcess($event, country)" accept=".json" hidden>Import Locations</label>
				<div>
					{{ country.found ? country.found.length : "0" }} / <input type="number" :min="country.found ? country.found.length : 0" v-model="country.nbNeeded" />
				</div>
			</div>
		</div>
		<Button
		@click="clearMarkers"
		class="bg-warning"
		text="Clear markers"
		optText="(for performance, this won't erase your generated locations)"
		title="Clear markers"
		/>
	</div>

	<div class="overlay top right flex-col gap">
		<div v-if="!state.started" class="settings">
			<h4 class="center">Settings</h4>
			<Checkbox v-model:checked="settings.rejectUnofficial" label="Reject unofficial" />
			<hr />

			<div v-if="settings.rejectUnofficial">
				<Checkbox v-model:checked="settings.rejectNoDescription" label="Reject locations without description" title="This might prevent trekkers in most cases, but can reject regular streetview without description. (eg. Mongolia/South Korea panoramas mostly don't have description)" />
					<hr />
					<Checkbox v-model:checked="settings.getIntersection" label="Prefer intersections" />
					<hr />
				</div>

				<Checkbox v-model:checked="settings.rejectDateless" label="Reject locations without date" title="This will prevent the local business tripod coverage that doesn't have a date." />
				<hr />
				<div class="adjustHeading" title="0° will point directly towards the road.">
					<Checkbox v-model:checked="settings.adjustHeading" label="Adjust heading" />
					<div v-if="settings.adjustHeading" class="indent">
						<label class="flex wrap">
							Deviation <input type="range" v-model.number="settings.headingDeviation" min="0" max="50" /> (+/- {{ settings.headingDeviation }}°)
						</label>
					</div>
					<hr />
				</div>

				<div class="adjustPitch" title="0 by default. -90° for tarmac/+90° for sky">
					<Checkbox v-model:checked="settings.adjustPitch" label="Adjust pitch" />
					<div v-if="settings.adjustPitch" class="indent">
						<label class="flex wrap">
							Pitch deviation <input type="range" v-model.number="settings.pitchDeviation" min="-90" max="90" /> ({{ settings.pitchDeviation }}°)
						</label>
					</div>
					<hr />
				</div>

				<div title="Radius in which to search for a panorama.
Keep it between 100-1000m for best results. Increase it for poorly covered territories/intersections/specific search cases.">
					Radius
					<input type="number" v-model.number="settings.radius" @change="handleRadiusInput" />
					m
				</div>
				<hr />

				<div class="flex space-between mb-2">
					<label>From</label>
					<input type="month" v-model="settings.fromDate" min="2007-01" :max="dateToday" />
				</div>
				<div class="flex space-between">
					<label>To</label>
					<input type="month" v-model="settings.toDate" :max="dateToday" />
				</div>
				<hr />

				<Checkbox v-model:checked="settings.checkAllDates" label="Check all dates" title="This will check the dates of nearby coverage (the dates shown when you click the time machine/clock icon). This is helpful for finding coverage within a specific timeframe." />
				<hr />

				<Checkbox v-model:checked="settings.checkLinks" label="Check linked panos" />
				<div v-if="settings.checkLinks">
					<input type="range" v-model.number="settings.linksDepth" min="1" max="10" /> Depth: {{ settings.linksDepth }}
				</div>
				<hr />

				<div class="customLayers">
					<h4 class="center mb-2">Custom Layers ({{ Object.keys(customLayers).length }})</h4>
					<input type="file" @change="customLayerFileProcess" accept=".txt,.json,.geojson" />
					<select @change="importLayer">
						<option value=""></option>
						<option value="/geojson/us_county_min.json">US Counties</option>
						<option value="/geojson/urban_areas.geojson">Urban Areas</option>
					</select>
					<div v-for="(value, name, index) of customLayers" class="line flex space-between">
						<div class="flex-center">
							{{ name }}
						</div>
						<a @click="selectAllLayer(value)" class="smallbtn bg-success" style="width:25%;">Select All</a>
						<button @click="removeCustomLayer(name)" type="button" class="close" aria-label="Close">×</button>
					</div>
				</div>
			</div>

			<Button
			v-if="canBeStarted"
			@click="handleClickStart"
			:class="state.started ? 'bg-danger' : 'bg-success'"
			:text="state.started ? 'Pause' : 'Start'"
			title="Space bar/Enter"
			/>

			<Button @click="exportDrawnLayer" text="Export Drawn Layer" style="background-color:#005CC8" />
		</div>

		<div v-if="!state.started && hasResults" class="overlay export bottom right">
			<h4 class="center mb-2">Export selection to</h4>
			<div class="flex gap">
				<CopyToClipboard :selection="selected" />
				<ExportToJSON :selection="selected" />
				<ExportToCSV :selection="selected" />
			</div>
		</div>
	</template>

	<script setup>
	import { onMounted, ref, reactive, computed } from "vue";
	import Button from "@/components/Elements/Button.vue";
	import Checkbox from "@/components/Elements/Checkbox.vue";
	import Spinner from "@/components/Elements/Spinner.vue";
	import Logo from "@/components/Elements/Logo.vue";

	import CopyToClipboard from "@/components/copyToClipboard.vue";
	import ExportToJSON from "@/components/exportToJSON.vue";
	import ExportToCSV from "@/components/exportToCSV.vue";

	import L from "leaflet";
	import "leaflet/dist/leaflet.css";
	import "leaflet-draw/dist/leaflet.draw.js";
	import "leaflet-draw/dist/leaflet.draw.css";
	window.type = !0;
	import marker from "@/assets/images/marker-icon.png";

	import "leaflet.markercluster/dist/leaflet.markercluster.js";
	import "leaflet.markercluster/dist/MarkerCluster.css";
	import "leaflet.markercluster/dist/MarkerCluster.Default.css";

	import booleanPointInPolygon from "@turf/boolean-point-in-polygon";

	import borders from "@/utils/borders.json";

	const state = reactive({
		started: false,
		polygonID: 0,
	});

	const dateToday = new Date().getFullYear() + "-" + String(new Date().getMonth() + 1).padStart(2, '0');

	const settings = reactive({
		radius: 500,
		rejectUnofficial: true,
		rejectNoDescription: false,
		rejectDateless: true,
		adjustHeading: true,
		headingDeviation: 0,
		adjustPitch: true,
		pitchDeviation: 10,
		rejectByYear: false,
		fromDate: "2007-05",
		toDate: dateToday,
		getIntersection: false,
		checkAllDates: true,
		checkLinks: false,
		linksDepth: 2,
		markersOnImport: false
	});

	const select = ref("Select a country or draw a polygon");
	const selected = ref([]);
	const canBeStarted = computed(() => selected.value.some((country) => country.found.length < country.nbNeeded));
	const hasResults = computed(() => selected.value.some((country) => country.found.length > 0));

	let map;
	let allFound = [];
	const allFoundPanoIds = new Set();
	let customLayers = {};
	let successfulRequests = 0;
	const customPolygonsLayer = new L.FeatureGroup();
	const markerLayer = L.markerClusterGroup({
		maxClusterRadius: 100,
		disableClusteringAtZoom: 15
	});
	const geojson = L.geoJson(borders, {
		style: style,
		onEachFeature: onEachFeature,
	});
	const roadmapLayer = L.tileLayer("https://{s}.google.com/vt/lyrs=m&hl=en&x={x}&y={y}&z={z}", { subdomains: ["mt0", "mt1", "mt2", "mt3"] });
	const googleSatelliteLayer = L.tileLayer("http://mt0.google.com/vt/lyrs=y&hl=en&x={x}&y={y}&z={z}", { subdomains: ["mt0", "mt1", "mt2", "mt3"] });
	const googleTerrainLayer = L.tileLayer("http://mt0.google.com/vt/lyrs=p&hl=en&x={x}&y={y}&z={z}", { subdomains: ["mt0", "mt1", "mt2", "mt3"] });
	const osmLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' });
	const cartoLightLayer = L.tileLayer("https://cartodb-basemaps-{s}.global.ssl.fastly.net/light_all/{z}/{x}/{y}.png", { subdomains: ["a", "b", "c"] });
	const cartoDarkLayer = L.tileLayer("https://cartodb-basemaps-{s}.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png", { subdomains: ["a", "b", "c"] });
	const gsvLayer = L.tileLayer("https://maps.googleapis.com/maps/vt?pb=!1m5!1m4!1i{z}!2i{x}!3i{y}!4i256!2m8!1e2!2ssvv!4m2!1scb_client!2sapiv3!4m2!1scc!2s*211m3*211e3*212b1*213e2*211m3*211e2*212b1*213e2!3m3!3sUS!12m1!1e68!4e0");
	const gsvLayer2 = L.tileLayer("https://{s}.google.com/mapslt?lyrs=svv&x={x}&y={y}&z={z}&w=256&h=256&hl=en&style=40,18", { subdomains: ["mt0", "mt1", "mt2", "mt3"] });
	const gsvLayer3 = L.tileLayer("https://maps.googleapis.com/maps/vt?pb=!1m5!1m4!1i{z}!2i{x}!3i{y}!4i256!2m8!1e2!2ssvv!4m2!1scb_client!2sapiv3!4m2!1scc!2s*211m3*211e3*212b1*213e2*211m3*211e2*212b1*213e2!3m3!3sUS!12m1!1e68!4e0", {minZoom: 12, minNativeZoom: 14});
	const baseMaps = {"Roadmap": roadmapLayer, "Satellite": googleSatelliteLayer, "Terrain": googleTerrainLayer, "OSM": osmLayer, "Carto Light": cartoLightLayer, "Carto Dark": cartoDarkLayer};
	const overlayMaps = {"Google Street View": gsvLayer, "Google Street View Official Only": gsvLayer2, "Google Street View Roads (Only Works at Zoom Level 12+)": gsvLayer3};
	const drawControl = new L.Control.Draw({
		position: "bottomleft",
		draw: {
			polyline: false,
			marker: false,
			circlemarker: false,
			circle: false,
			polygon: {
				allowIntersection: false,
				drawError: {
					color: "#e1e100",
					message: "<strong>Polygon draw does not allow intersections!<strong> (allowIntersection: false)",
				},
				shapeOptions: { color: "#5d8ce3" },
			},
			rectangle: { shapeOptions: { color: "#5d8ce3" } },
		},
		edit: { featureGroup: customPolygonsLayer },
	});

	onMounted(() => {
		map = L.map("map", {
			attributionControl: false,
			center: [0, 0],
			preferCanvas: true,
			zoom: 2,
			zoomControl: false,
			worldCopyJump: true
		});
		roadmapLayer.addTo(map);
		geojson.addTo(map);
		customPolygonsLayer.addTo(map);
		markerLayer.addTo(map);
		L.control.layers(baseMaps, overlayMaps, {position: "bottomleft"}).addTo(map);
		map.addControl(drawControl);

		map.on("draw:created", (e) => {
			state.polygonID++;
			const polygon = e.layer;
			polygon.feature = e.layer.toGeoJSON();
			polygon.found = [];
			polygon.nbNeeded = 10000000;
			polygon.checkedPanos = new Set();
			polygon.feature.properties.name = `Custom polygon ${state.polygonID}`;
			polygon.setStyle(customPolygonStyle());
			polygon.setStyle(highlighted());
			polygon.on("mouseover", (e) => highlightFeature(e));
			polygon.on("mouseout", (e) => resetHighlight(e));
			polygon.on("click", (e) => selectCountry(e));
			customPolygonsLayer.addLayer(polygon);
			selected.value.push(polygon);
		});
		map.on("draw:edited", (e) => {
			e.layers.eachLayer((layer) => {
				const polygon = layer;
				polygon.feature = layer.toGeoJSON();
				const index = selected.value.findIndex((x) => getName(x) === getName(layer));
				if (index != -1) selected.value[index] = polygon;
			});
		});
		map.on("draw:deleted", (e) => {
			e.layers.eachLayer((layer) => {
				const index = selected.value.findIndex((x) => getName(x) === getName(layer));
				if (index != -1) selected.value.splice(index, 1);
			});
		});

		// Fix hard reload issue
		const mapDiv = document.getElementById("map");
		const resizeObserver = new ResizeObserver(() => {
			map.invalidateSize();
		});
		resizeObserver.observe(mapDiv);
	});

	async function readFileAsText(file) {
		let result = await new Promise((resolve) => {
			let fileReader = new FileReader();
			fileReader.onload = (e) => resolve(fileReader.result);
			fileReader.readAsText(file);
		});

		return result;
	}

	async function customLayerFileProcess(e) {
		for (let file of e.target.files) {
			let result = await readFileAsText(file);
			try {
				let JSONResult = JSON.parse(result);
				addCustomLayer(JSONResult, file.name);
			} catch (e) {
				alert("Invalid GeoJSON.");
			}
		}
	}

	function addCustomLayer(geoJSON, name) {
		try {
			let newLayer = L.geoJson(geoJSON, {
				style: style,
				onEachFeature: onEachFeature
			});
			for (let layer in newLayer._layers) {
				let polygon = newLayer._layers[layer];
				polygon.setStyle(customPolygonStyle());
			}
			newLayer.addTo(map);

			customLayers[name] = newLayer;
		} catch (e) {
			alert("Invalid GeoJSON.");
		}
	}

	async function locationsFileProcess(e, country) {
		for (let file of e.target.files) {
			let result = await readFileAsText(file);
			if (file.type == "application/json") {
				try {
					let JSONResult = JSON.parse(result);
					if (!JSONResult.customCoordinates) {
						throw Error;
					}
					for (let location of JSONResult.customCoordinates) {
						if (!location.panoId || !location.lat || !location.lng) continue;
						addLocation(location, country, settings.markersOnImport);
					}
				} catch (e) {
					alert("Invalid JSON.");
				}
			} else {
				alert("Unknown file type: " + file.type + ". Only JSON may be imported.");
			}
		}
	}

	async function importLayer(e) {
		if (!e.target.value) return;
		const response = await fetch(e.target.value);
		const data = await response.json();
		addCustomLayer(data, e.target.value);
		e.target.options[e.target.selectedIndex].remove();
		e.target.value = "";
	}

	function removeCustomLayer(name) {
		customLayers[name].remove();
		delete customLayers[name];
	}

	function exportDrawnLayer() {
		const dataUri = "data:application/json;charset=utf-8," + encodeURIComponent(JSON.stringify(customPolygonsLayer.toGeoJSON()));
		const fileName = `DrawnLayer.geojson`;
		const linkElement = document.createElement("a");
		linkElement.href = dataUri;
		linkElement.download = fileName;
		linkElement.click();
	}

	const handleRadiusInput = (e) => {
		const value = parseInt(e.target.value);
		if (!value || value < 50) {
			settings.radius = 50;
		} else if (value > 10000) {
			settings.radius = 10000;
		}
	};

	const myIcon = L.icon({
		iconUrl: marker,
		iconAnchor: [12, 41],
	});

	// Process
	document.onkeydown = () => {
		if (window.event.keyCode == "13" || window.event.keyCode == "32") {
			handleClickStart();
		}
	};
	const handleClickStart = () => {
		state.started = !state.started;
		start();
	};

	const start = async () => {
		for (let polygon of selected.value) {
			await generate(polygon);
		}
		state.started = false;
	};

	Array.prototype.chunk = function (n) {
		if (!this.length) {
			return [];
		}
		return [this.slice(0, n)].concat(this.slice(n).chunk(n));
	};

	const SV = new google.maps.StreetViewService();

	top.all=function(){return allFound;};
	top.allCSV=function(){
		let csv = "";
		let nbLocs = 0;
		allFound.forEach((loc) => {
			csv += loc.lat + "," + loc.lng + ",\n";
			nbLocs++;
		});
		const dataUri = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
		const fileName = `Generated map (${nbLocs} location${nbLocs > 1 ? "s" : ""}).csv`;
		const linkElement = document.createElement("a");
		linkElement.href = dataUri;
		linkElement.download = fileName;
		linkElement.click();
	};

	top.allJSON = () => {
		const dataUri = "data:application/json;charset=utf-8," + encodeURIComponent(JSON.stringify({ customCoordinates: allFound }));
		const fileName = `Generated map (${allFound.length} location${allFound.length > 1 ? "s" : ""}).json`;
		const linkElement = document.createElement("a");
		linkElement.href = dataUri;
		linkElement.download = fileName;
		linkElement.click();
	};

	const generate = async (country) => {
		return new Promise(async (resolve) => {
			while (country.found.length < country.nbNeeded) {
				if (!state.started) return;
				country.isProcessing = true;
				const randomCoords = [];
				let n = Math.min(country.nbNeeded*100,1000);
				while (randomCoords.length < n) {
					const point = randomPointInPoly(country);
					if (booleanPointInPolygon([point.lng, point.lat], country.feature)) {
						randomCoords.push(point);
					}
				}
				for (let locationGroup of randomCoords.chunk(75)) {
					await Promise.allSettled(locationGroup.map((l) => SVreq(l, country)));
				}
			}
			resolve();
			country.isProcessing = false;
		});
	};

	function SVreq(loc, country) {
		return new Promise(async (resolve, reject) => {
			await getLoc(loc, country, resolve, reject);
		});
	}

	async function getLoc(loc, country, resolve, reject) {
		SV.getPanoramaByLocation(new google.maps.LatLng(loc.lat, loc.lng), settings.radius, async (res, status) => {
			if (status != google.maps.StreetViewStatus.OK) return reject();
			successfulRequests++;
			if (settings.checkAllDates && res.time) {
				if (!res.time.length) return reject();
				let fromDate = Date.parse(settings.fromDate);
				let toDate = Date.parse(settings.toDate);
				let dateWithin = false;
				for (let loc of res.time) {
					if (settings.rejectUnofficial && loc.pano.length != 22) continue; // Checks if pano ID is 22 characters long. Otherwise, it's an Ari
					let date = Object.values(loc).find((val) => val instanceof Date);
					let iDate = Date.parse(date.getFullYear() + "-" + (date.getMonth() > 8 ? "" : "0") + (date.getMonth() + 1)); // this will parse the Date object from res.time[i] (like Fri Oct 01 2021 00:00:00 GMT-0700 (Pacific Daylight Time)) to a local timestamp, like Date.parse("2021-09") == 1630454400000 for Pacific Daylight Time
					if (iDate >= fromDate && iDate <= toDate) { // if date ranges from fromDate to toDate, set dateWithin to true and stop the loop
						dateWithin = true;
						getPano(loc.pano, country);
						//TODO: add settings.onlyOneLoc
						//if(settings.onlyOneLoc)break;
					}
				}
				if (!dateWithin) return reject();
			} else {
				if (Date.parse(res.imageDate) < Date.parse(settings.fromDate) || Date.parse(res.imageDate) > Date.parse(settings.toDate)) return reject();
				if (settings.rejectDateless && !res.imageDate) return reject();
				getPano(res.location.pano, country);
			}

			resolve();
		}).catch((e) => reject(e.message));
	}

	function isPanoGood(pano) {
		if (settings.rejectUnofficial) {
			if (pano.location.pano.length != 22) return false;
			//if (!/^\xA9 (?:\d+ )?Google$/.test(pano.copyright)) return false;
			if (settings.rejectNoDescription && !pano.location.description && !pano.location.shortDescription) return false;
			if (settings.getIntersection && pano.links.length < 3) return false;
		}

		if (settings.rejectDateless && !pano.imageDate) return false;
		//if (!pano.time || !pano.time.length) return false;
		let fromDate = Date.parse(settings.fromDate);
		let toDate = Date.parse(settings.toDate);
		let locDate = Date.parse(pano.imageDate);
		if (locDate < fromDate || locDate > toDate) return false;


		return true;
	}

	top.gp = function(id) {
		return getPano(id, null);
	}

	top.goto = function(lat, lng) {
		map.setView(new L.LatLng(lat, lng), 13);
	}

	function getPano(id, country) {
		return getPanoDeep(id, country, 0);
	}

	function getPanoDeep(id, country, depth) {
		//console.log(id, depth);
		if (depth > settings.linksDepth) return;
		if (country.checkedPanos.has(id)) return;
		else country.checkedPanos.add(id);
		SV.getPanorama({"pano":id}, async (pano, status) => {
			if (status == google.maps.StreetViewStatus.UNKNOWN_ERROR) {
				country.checkedPanos.delete(id);
				return getPanoDeep(id, country, depth);
			}
			else if (status != google.maps.StreetViewStatus.OK) return;
			successfulRequests++;
			if(!pano) console.log(status, pano);

			let inCountry = booleanPointInPolygon([pano.location.latLng.lng(), pano.location.latLng.lat()], country.feature);
			let isPanoGoodAndInCountry = isPanoGood(pano) && inCountry;

			if(settings.checkAllDates && pano.time) {
				let fromDate = Date.parse(settings.fromDate);
				let toDate = Date.parse(settings.toDate);
				for (let loc of pano.time) {
					if (settings.rejectUnofficial && loc.pano.length != 22) continue; // Checks if pano ID is 22 characters long. Otherwise, it's an Ari
					let date = Object.values(loc).find((val) => val instanceof Date);
					let iDate = Date.parse(date.getFullYear() + "-" + (date.getMonth() > 8 ? "" : "0") + (date.getMonth() + 1)); // this will parse the Date object from res.time[i] (like Fri Oct 01 2021 00:00:00 GMT-0700 (Pacific Daylight Time)) to a local timestamp, like Date.parse("2021-09") == 1630454400000 for Pacific Daylight Time
					if (iDate >= fromDate && iDate <= toDate) { // if date ranges from fromDate to toDate, set dateWithin to true and stop the loop
						getPanoDeep(loc.pano, country, isPanoGoodAndInCountry ? 1 : depth + 1);
						//TODO: add settings.onlyOneLoc
						//if(settings.onlyOneLoc)break;
					}
				}
			}



			if (settings.checkLinks) {
				if (pano.links) {
					for (let loc of pano.links) {
						getPanoDeep(loc.pano, country, isPanoGoodAndInCountry?1:depth+1);
					}
				}
				if (pano.time) {
					for (let loc of pano.time) {
						getPanoDeep(loc.pano, country, isPanoGoodAndInCountry?1:depth+1);
					}
				}
			}
			if (isPanoGoodAndInCountry) addLoc(pano, country);
			return pano;
		});
	}


	function addLoc(pano, country) {
		let location = {
			panoId: pano.location.pano,
			lat: pano.location.latLng.lat(),
			lng: pano.location.latLng.lng(),
			heading: settings.adjustHeading && pano.links.length > 0 ? parseInt(pano.links[0].heading) + randomInRange(-settings.headingDeviation, settings.headingDeviation) : 0,
			pitch: settings.adjustPitch ? settings.pitchDeviation : 0,
			imageDate: pano.imageDate
		};

		return addLocation(location, country, true);
	}

	function addLocation(location, country, marker) {
		if (allFoundPanoIds.has(location.panoId)) return;
		allFound.push(location);
		allFoundPanoIds.add(location.panoId);

		if (!country || country.found.length < country.nbNeeded) {
			if (country) country.found.push(location);
			if (marker) L.marker([location.lat, location.lng], { icon: myIcon }).on("click", () => {window.open(`https://www.google.com/maps/@?api=1&map_action=pano&pano=${location.panoId}${location.heading ? "&heading=" + location.heading : ""}${location.pitch ? "&pitch=" + location.pitch : ""}`,"_blank");}).addTo(markerLayer);
		}
	}

	const randomInRange = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

	const randomPointInPoly = (polygon) => {
		const bounds = polygon.getBounds();
		const x_min = bounds.getEast();
		const x_max = bounds.getWest();
		const y_min = bounds.getSouth();
		const y_max = bounds.getNorth();

		const lat = y_min + Math.random() * (y_max - y_min);
		const lng = x_min + Math.random() * (x_max - x_min);
		return { lat, lng };
	};

	// Map features
	function onEachFeature(feature, layer) {
		layer.on({
			mouseover: highlightFeature,
			mouseout: resetHighlight,
			click: selectCountry,
		});
	}

	function getName(poly) {
		let properties = poly.feature.properties;
		return properties.name || properties.NAME || properties.NAMELSAD || properties.NAMELSAD10 || properties.city || properties.CITY || properties.county || properties.COUNTY || properties.COUNTY_STATE_CODE || properties.COUNTY_STATE_NAME || properties.PRNAME || properties.prov_name_en || properties.state || properties.STATE || properties.country || properties.COUNTRY || properties.id || properties.ID;
	}

	function initLayer(layer) {
		if (!layer.found) layer.found = [];
		if (!layer.nbNeeded) layer.nbNeeded = 10000000;
		if (!layer.checkedPanos) layer.checkedPanos = new Set();
		return layer;
	}

	function selectCountry(e) {
		if (state.started) return;
		const country = e.target;
		const index = selected.value.findIndex((x) => getName(x) === getName(country));
		if (index == -1) {
			initLayer(country);
			country.setStyle(highlighted());
			selected.value.push(country);
		} else {
			selected.value.splice(index, 1);
			resetHighlight(e);
		}
	}

	function selectAll() {
		selected.value = geojson.getLayers().map((country) => {
			initLayer(country);
			return country;
		});
		geojson.setStyle(highlighted);
	}

	function selectAllLayer(layer) {
		layer.setStyle(highlighted);
		for (let feature in layer._layers) {
			initLayer(layer._layers[feature]);
			if (!selected.value.includes(layer._layers[feature])) selected.value.push(layer._layers[feature]);
		}
	}

	function deselectAll() {
		selected.value.length = 0;
		geojson.setStyle(style());
		customPolygonsLayer.setStyle(customPolygonStyle());
		Object.values(customLayers).forEach(customLayer => Object.values(customLayer._layers).forEach(polygon => polygon.setStyle(customPolygonStyle())));
	}

	function highlightFeature(e) {
		if (state.started) return;
		const layer = e.target;
		const index = selected.value.findIndex((x) => getName(x) === getName(layer));
		if (index == -1) {
			layer.setStyle(highlighted());
		}
		select.value = `${getName(layer)} ${layer.found ? "(" + layer.found.length + ")" : "(0)"}`;
	}
	function resetHighlight(e) {
		const layer = e.target;
		const index = selected.value.findIndex((x) => getName(x) === getName(layer));
		if (index == -1) {
			layer.setStyle(removeHighlight());
		}
		select.value = "Select a country or draw a polygon";
	}
	function style() {
		return {
			opacity: 0,
			fillOpacity: 0,
		};
	}
	function customPolygonStyle() {
		return {
			weight: 2,
			opacity: 1,
			color: getRandomColor(),
			fillOpacity: 0,
		};
	}
	function highlighted() {
		return {
			fillColor: getRandomColor(),
			fillOpacity: 0.6,
		};
	}
	function removeHighlight() {
		return { fillOpacity: 0 };
	}
	function getRandomColor() {
		const red = Math.floor(((1 + Math.random()) * 256) / 2);
		const green = Math.floor(((1 + Math.random()) * 256) / 2);
		const blue = Math.floor(((1 + Math.random()) * 256) / 2);
		return "rgb(" + red + ", " + green + ", " + blue + ")";
	}
	function clearMarkers() {
		markerLayer.clearLayers();
	}
	</script>

	<style>
	@import "@/assets/main.css";
	.smallbtn {
    	color: #000;
    	display: block;
    	padding: 0.2rem;
    	text-align: center;
    	border-radius: 4px;
    	cursor: pointer;
    	user-select: none;
    	box-shadow: 0 0 2px rgb(0 0 0 / 40%);
	}
	button.close {
    	padding: 0;
    	background-color: transparent;
    	border: 0;
		font-size: 25px;
		color: red;
		cursor: pointer;
	}
	#map {
		z-index: 0;
		height: 100vh;
	}
	.leaflet-container {
		background-color: #2c2c2c;
	}
	.overlay {
		position: absolute;
	}
	.select,
	.selected,
	.settings,
	.export {
		padding: var(--space-2);
		border-radius: 5px;
		background: rgba(0, 0, 0, 0.7);
		box-shadow: 0 0 2px rgba(0, 0, 0, 0.4);
	}
	.selected {
		max-height: calc(100vh - 390px);
		overflow: auto;
	}
	.settings {
		max-width: 375px;
		max-height: calc(100vh - 180px);
		overflow: auto;
	}
	.export {
		min-width: 375px;
	}
	.line {
		line-height: 1.5rem;
	}
	</style>
