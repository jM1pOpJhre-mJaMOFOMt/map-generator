const SV = new google.maps.StreetViewService();

export default function SVreq(loc, settings) {
	return new Promise(async (resolve, reject) => {
		await SV.getPanoramaByLocation(new google.maps.LatLng(loc.lat, loc.lng), settings.radius, async (res, status) => {
			var locations = [];
			if (status != google.maps.StreetViewStatus.OK) return reject();
			if (settings.rejectUnofficial) {
				if (!/^\xA9 (?:\d+ )?Google$/.test(res.copyright)) return reject();
				if (settings.rejectNoDescription && !res.location.description && !res.location.shortDescription) return reject();
				if (settings.getIntersection && res.links.length < 3) return reject();
			}
			if (settings.checkAllDates) {
				if (!res.time || !res.time.length) return reject();
				var fromDate = Date.parse(settings.fromDate);
				var toDate = Date.parse(settings.toDate);
				var dateWithin = false;
				for (var i = 0; i < res.time.length; i++) {
					if (settings.rejectUnofficial && res.time[i].pano.length != 22) continue; // Checks if pano ID is 22 characters long. Otherwise, it's an Ari
					var iDate = Date.parse(res.time[i].jm.getFullYear() + "-" + (res.time[i].jm.getMonth() + 1)); // this will parse the Date object from res.time[i] (like Fri Oct 01 2021 00:00:00 GMT-0700 (Pacific Daylight Time)) to a local timestamp, like Date.parse("2021-09") == 1630454400000 for Pacific Daylight Time
					if (iDate >= fromDate && iDate <= toDate) { // if date ranges from fromDate to toDate, set dateWithin to true and stop the loop
						dateWithin = true;
						let result = (await SV.getPanorama({pano: res.time[i].pano})).data;
						locations.push(
							{
								pano: res.time[i].pano,
								lat: result.location.latLng.lat(),
								lng: result.location.latLng.lng(),
								heading: settings.adjustHeading && res.links.length > 0 ? parseInt(result.links[0].heading) + randomInRange(-settings.headingDeviation, settings.headingDeviation) : 0,
								pitch: settings.adjustPitch ? settings.pitchDeviation : 0
							}
						);
						//TODO: add settings.onlyOneLoc
						//if(settings.onlyOneLoc)break;
					}
				}
				if (!dateWithin) return reject();
			}
			else {
				if (Date.parse(res.imageDate) < Date.parse(settings.fromDate) || Date.parse(res.imageDate) > Date.parse(settings.toDate)) return reject();
				if (settings.rejectDateless && !res.imageDate) return reject();
				locations.push(
					{
						pano: res.location.pano,
						lat: res.location.latLng.lat(),
						lng: res.location.latLng.lng(),
						heading: settings.adjustHeading && res.links.length > 0 ? parseInt(res.links[0].heading) + randomInRange(-settings.headingDeviation, settings.headingDeviation) : 0,
						pitch: settings.adjustPitch ? settings.pitchDeviation : 0
					}
				);
			}
			resolve(locations);
		}).catch((e) => reject(e.message));
	});
}

const randomInRange = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
