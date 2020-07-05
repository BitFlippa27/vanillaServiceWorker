(function Site(global){
	"use strict";

	var offlineIcon;
	var isOnline = ("onLine" in navigator) ? navigator.onLine : true;
	var isLoggedIn = /isLoggedIn=1/.test(document.cookie.toString() || "");
	var svworker;
	var usingSW = ("serviceWorker" in navigator);
	var swRegistration;


	document.addEventListener("DOMContentLoaded",ready,false);

	if (usingSW) {
		initServiceWorker().catch(console.error);
	}

	global.isSiteOnline = isSiteOnline;

	//checkt direkt nach laden der Seite die Verbindung und zeigt Verbindung mit Icon an
	function ready() {
		offlineIcon = document.getElementById("connectivity-status");
		if(!isOnline) {
			offlineIcon.classList.remove("hidden");  
		}

		window.addEventListener("online", function online(){
			offlineIcon.classList.add("hidden");
			isOnline = true;
			sendStatusUpdate(); //ohne Parameter, nimmt also automatisch aktiven SW
		});

		window.addEventListener("offline", function offline() {
			offlineIcon.classList.remove("hidden");
			isOnline = false;
			sendStatusUpdate(); 
		});
	}
	//Status für add-post Seite
	function isSiteOnline() {
		return isOnline;
	}

	async function initServiceWorker() {
		swRegistration = await navigator.serviceWorker.register("/sw.js",{  
			updateViaCache: "none" //wir wollen caching selber kontrollieren
		});	
		// 3 Statuse 
		svworker = swRegistration.installing || swRegistration.waiting || swRegistration.active;  
		sendStatusUpdate(svworker);
		//Wenn Statusänderung, Benachrichtigung dass neuer aktiver Service Worker jetzt die Webseite kontrolliert
		navigator.serviceWorker.addEventListener("controllerchange", function onController(){
			svworker = navigator.serviceWorker.controller; 
			sendStatusUpdate(svworker); 
		});
		//auf SW Nachrichten hören
		navigator.serviceWorker.addEventListener("message", onSWMessage);
	}
	//Nachrichten/Anfrage vom SW zur Webseite 
	function onSWMessage(evt) {
		var { data } = evt;
		if (data.requestStatusUpdate) {  
			console.log(`Received status update request from service worker, responding...`);
			 //SW kommuniziert mit mehreren Seiten/Tabs somit Nachrichten an einen Message channel mit Ports wo SW hört
			sendStatusUpdate(evt.ports && evt.ports[0]); 
		
		}
	}
	//SW hat kein offline online event und hat kein Zugriff auf cookies(loginState), somit fragt er Webseite über Status
	function sendStatusUpdate(target) {
		sendSWMessage({statusUpdate: { isOnline, isLoggedIn }}, target);
	}

	async function sendSWMessage(msg, target) {
		if (target) {
			target.postMessage(msg);
		}
		else if (svworker) {
			svworker.postMessage(msg);
		}
		else {
			navigator.serviceWorker.controller.postMessage(msg);
		}
	}

})(window);
