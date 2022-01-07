<template>
	<div id="map"></div>
	<div class="overlay top left flex-col gap">
		<Logo class="mb-2" />
		<div v-if="!state.started">
			<h4 class="select mb-2">{{ select }}</h4>
			<div class="flex gap">
				<Button @click="selectAll" class="bg-success" text="Select all" title="Select all" />
				<Button v-if="selected.length" @click="deselectAll" class="bg-danger" text="Deselect all" title="Deselect all" />
			</div>
		</div>

		<div v-if="selected.length" class="selected">
			<h4 class="center mb-2">Countries/Territories ({{ selected.length }})</h4>
			<div v-for="country of selected" class="line flex space-between">
				<div class="flex-center">
					<span v-if="country.feature.properties.code" :class="`flag-icon flag-` + country.feature.properties.code.toLowerCase()"></span>
					{{ country.feature.properties.name }}
					<Spinner v-if="state.started && country.isProcessing" class="ml-2" />
				</div>
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
				<Checkbox v-model:checked="settings.rejectNoDescription" label="Reject locations without description" />
				<small>This might prevent trekkers in most cases, but can reject regular streetview without description. (eg. Mongolia/South Korea panoramas mostly don't
					have description)</small>
					<hr />
					<Checkbox v-model:checked="settings.getIntersection" label="Prefer intersections" />
					<hr />
				</div>

				<Checkbox v-model:checked="settings.rejectDateless" label="Reject locations without date" />
				<small>This will prevent the local business tripod coverage that doesn't have a date.</small>
				<hr />

				<Checkbox v-model:checked="settings.adjustHeading" label="Adjust heading" />
				<div v-if="settings.adjustHeading" class="indent">
					<label class="flex wrap">
						Deviation <input type="range" v-model.number="settings.headingDeviation" min="0" max="50" /> (+/- {{ settings.headingDeviation }}°)
					</label>
					<small>0° will point directly towards the road.</small>
				</div>
				<hr />

				<Checkbox v-model:checked="settings.adjustPitch" label="Adjust pitch" />
				<div v-if="settings.adjustPitch" class="indent">
					<label class="flex wrap">
						Pitch deviation <input type="range" v-model.number="settings.pitchDeviation" min="-90" max="90" /> ({{ settings.pitchDeviation }}°)
					</label>
					<small>0 by default. -90° for tarmac/+90° for sky</small>
				</div>
				<hr />

				<div>
					Radius
					<input type="number" v-model.number="settings.radius" @change="handleRadiusInput" />
					m
				</div>
				<small>
					Radius in which to search for a panorama.<br />
					Keep it between 100-1000m for best results. Increase it for poorly covered territories/intersections/specific search cases.
				</small>
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

				<Checkbox v-model:checked="settings.checkAllDates" label="Check all dates" />
				<small>
					This will check the dates of nearby coverage (the dates shown when you click the time machine/clock icon). This is helpful for finding coverage within a specific timeframe.
				</small>
				<hr />

				<Checkbox v-model:checked="settings.checkLinks" label="Check linked panos" />
			</div>

			<Button
			v-if="canBeStarted"
			@click="handleClickStart"
			:class="state.started ? 'bg-danger' : 'bg-success'"
			:text="state.started ? 'Pause' : 'Start'"
			title="Space bar/Enter"
			/>
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
		fromDate: "2009-01",
		toDate: dateToday,
		getIntersection: false,
		checkAllDates: true,
		checkLinks: true
	});

	const select = ref("Select a country or draw a polygon");
	const selected = ref([]);
	const canBeStarted = computed(() => selected.value.some((country) => country.found.length < country.nbNeeded));
	const hasResults = computed(() => selected.value.some((country) => country.found.length > 0));

	let map;
	let allFound=[];
	const customPolygonsLayer = new L.FeatureGroup();
	const markerLayer = L.markerClusterGroup({
		maxClusterRadius: 100,
		disableClusteringAtZoom: 15
	});
	const geojson = L.geoJson(borders, {
		style: style,
		onEachFeature: onEachFeature,
	});
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
			worldCopyJump: true,
			layers: [L.tileLayer("https://{s}.google.com/vt/lyrs=m&hl=en&x={x}&y={y}&z={z}", { subdomains: ["mt0", "mt1", "mt2", "mt3"], type: "roadmap" })],
		});

		geojson.addTo(map);
		customPolygonsLayer.addTo(map);
		markerLayer.addTo(map);
		map.addControl(drawControl);

		map.on("draw:created", (e) => {
			state.polygonID++;
			const polygon = e.layer;
			polygon.feature = e.layer.toGeoJSON();
			polygon.found = [];
			polygon.nbNeeded = 1000000;
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
				const index = selected.value.findIndex((x) => x.feature.properties.name === layer.feature.properties.name);
				if (index != -1) selected.value[index] = polygon;
			});
		});
		map.on("draw:deleted", (e) => {
			e.layers.eachLayer((layer) => {
				const index = selected.value.findIndex((x) => x.feature.properties.name === layer.feature.properties.name);
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
		const dataUri = "data:application/json;charset=utf-8," + encodeURIComponent(JSON.stringify(allFound));
		const fileName = `Generated map (${allFound.length} location${allFound.length > 1 ? "s" : ""}).json`;
		const linkElement = document.createElement("a");
		linkElement.href = dataUri;
		linkElement.download = fileName;
		linkElement.click();
	};

	top.importJSON = (list) => {
		for (let location of list) {
			if (!location.pano || !location.lat || !location.lng) continue;
			if (allFound.some(l => l.pano == location.pano)) continue; // prevent duplicates
			allFound.push(location);
		}
	};

	const generate = async (country) => {
		return new Promise(async (resolve) => {
			while (country.found.length < country.nbNeeded) {
				if (!state.started) return;
				country.isProcessing = true;
				const randomCoords = [];
				while (randomCoords.length < Math.min(country.nbNeeded,5000)) {
					const point = randomPointInPoly(country);
					if (booleanPointInPolygon([point.lng, point.lat], country.feature)) {
						randomCoords.push(point);
					}
				}
				for (let locationGroup of randomCoords.chunk(100)) {
					await Promise.allSettled(locationGroup.map((l) => SVreq(l, country)));
				}
			}
			resolve();
			country.isProcessing = false;
		});
	};

	const checkedPanos = new Set();

	function SVreq(loc, country) {
		return new Promise(async (resolve, reject) => {
			await getLoc(loc, country, resolve, reject);
		});
	}

	async function getLoc(loc, country, resolve, reject) {
		SV.getPanoramaByLocation(new google.maps.LatLng(loc.lat, loc.lng), settings.radius, async (res, status) => {
			let locations = [];
			if (status != google.maps.StreetViewStatus.OK) return reject();
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
			}
			else {
				if (Date.parse(res.imageDate) < Date.parse(settings.fromDate) || Date.parse(res.imageDate) > Date.parse(settings.toDate)) return reject();
				if (settings.rejectDateless && !res.imageDate) return reject();
				getPano(res.location.pano, country);
			}

			resolve(locations);
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
		if (depth > 5) return;
		if (checkedPanos.has(id)) return;
		else checkedPanos.add(id);
		SV.getPanorama({"pano":id}, async (pano, status) => {
			if (status == google.maps.StreetViewStatus.UNKNOWN_ERROR) {
				checkedPanos.delete(id);
				return getPanoDeep(id, country, depth);
			}
			else if (status != google.maps.StreetViewStatus.OK) return;
			if(!pano)console.log(status, pano);
			if(settings.checkAllDates && pano.time) {
				let fromDate = Date.parse(settings.fromDate);
				let toDate = Date.parse(settings.toDate);
				for (let loc of pano.time) {
					if (settings.rejectUnofficial && loc.pano.length != 22) continue; // Checks if pano ID is 22 characters long. Otherwise, it's an Ari
					let date = Object.values(loc).find((val) => val instanceof Date);
					let iDate = Date.parse(date.getFullYear() + "-" + (date.getMonth() > 8 ? "" : "0") + (date.getMonth() + 1)); // this will parse the Date object from res.time[i] (like Fri Oct 01 2021 00:00:00 GMT-0700 (Pacific Daylight Time)) to a local timestamp, like Date.parse("2021-09") == 1630454400000 for Pacific Daylight Time
					if (iDate >= fromDate && iDate <= toDate) { // if date ranges from fromDate to toDate, set dateWithin to true and stop the loop
						getPano(loc.pano, country);
						//TODO: add settings.onlyOneLoc
						//if(settings.onlyOneLoc)break;
					}
				}
			}
			if (settings.checkLinks) {
				if (pano.links) {
					for (let loc of pano.links) {
						getPanoDeep(loc.pano, country, isPanoGood(pano)?1:depth+1);
					}
				}
				if (pano.time) {
					for (let loc of pano.time) {
						getPanoDeep(loc.pano, country, isPanoGood(pano)?1:depth+1);
					}
				}
			}
			if (isPanoGood(pano)) addLoc(pano, country);
			return pano;
		});
	}


	function addLoc(pano, country) {
		if (allFound.some(l => l.pano == pano.location.pano)) return; // prevent duplicates

		let location = {
			pano: pano.location.pano,
			lat: pano.location.latLng.lat(),
			lng: pano.location.latLng.lng(),
			heading: settings.adjustHeading && pano.links.length > 0 ? parseInt(pano.links[0].heading) + randomInRange(-settings.headingDeviation, settings.headingDeviation) : 0,
			pitch: settings.adjustPitch ? settings.pitchDeviation : 0,
			imageDate: pano.imageDate
		};

		allFound.push(location);

		if (!country || country.found.length < country.nbNeeded) {
			if (country) country.found.push(location);
			L.marker([location.lat, location.lng], { icon: myIcon })
			.on("click", () => {
				window.open(
					`https://www.google.com/maps/@?api=1&map_action=pano&pano=${location.pano}
					${location.heading ? "&heading=" + location.heading : ""}
					${location.pitch ? "&pitch=" + location.pitch : ""}`,
					"_blank"
				);
			})
			.addTo(markerLayer);
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

	function selectCountry(e) {
		if (state.started) return;
		const country = e.target;
		const index = selected.value.findIndex((x) => x.feature.properties.name === country.feature.properties.name);
		if (index == -1) {
			if (!country.found) country.found = [];
			if (!country.nbNeeded) country.nbNeeded = 100;
			country.setStyle(highlighted());

			selected.value.push(country);
		} else {
			selected.value.splice(index, 1);
			resetHighlight(e);
		}
	}

	function selectAll() {
		selected.value = geojson.getLayers().map((country) => {
			if (!country.found) country.found = [];
			if (!country.nbNeeded) country.nbNeeded = 100;
			return country;
		});
		geojson.setStyle(highlighted);
	}

	function deselectAll() {
		selected.value.length = 0;
		geojson.setStyle(style());
		customPolygonsLayer.setStyle(customPolygonStyle());
	}

	function highlightFeature(e) {
		if (state.started) return;
		const layer = e.target;
		const index = selected.value.findIndex((x) => x.feature.properties.name === layer.feature.properties.name);
		if (index == -1) {
			layer.setStyle(highlighted());
		}
		select.value = `${layer.feature.properties.name} ${layer.found ? "(" + layer.found.length + ")" : "(0)"}`;
	}
	function resetHighlight(e) {
		const layer = e.target;
		const index = selected.value.findIndex((x) => x.feature.properties.name === layer.feature.properties.name);
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
