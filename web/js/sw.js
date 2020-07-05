"use strict";

//indexDB Objekt
importScripts("/js/external/idb-keyval-iife.min.js");


const version = 8;
var isOnline = true;
var isLoggedIn = false;
//bei neuem SW werden alte Caches gelöscht und alles wird neu gecached wenn SW Versionsnummer sich ändert
var cacheName = `Unternehmen-${version}`; 
var allPostsCaching = false;
										

var urlsToCache = {
	loggedOut: [		
		"/",
		"/about",
		"/contact",
		"login",
		"/404",
		"offline",
		"/js/blog.js",
		"/js/home.js",
		"/js/login.js",
		"/js/sw.js",
		"/js/add-post.js",
		"/js/external/idb-keyval-iife.min.js",
		"/css/style.css",
		"/images/logo.gif",
		"/images/offline.png"
	]
}

self.addEventListener("install", onInstall);
self.addEventListener("activate", onActivate);
self.addEventListener("message", onMessage);
self.addEventListener("fetch", onFetch);



main().catch(console.error);

//bei jedem neu registrierten SW, Status anfragen und alles cachen
async function main() {
	await sendMessage({ requestStatusUpdate: true});
	await cacheLoggedOutFiles();
	return cacheAllPosts();
}

//Statuanfrage an alle Clients
async function sendMessage(msg) {
	var allClients =  await clients.matchAll({ includeUncontrolled: true});  // Liste aller Clients
	return Promise.all(
		allClients.map(function clientMsg(client){
			var channel = new MessageChannel();   			//neuer Messagechannel für jeden Client
			channel.port1.onmessage = onMessage; 			//auf Statusupdates auf aktuellen Message Channel lauschen
			return client.postMessage(msg,[channel.port2]); // Statusanfrage senden

		})
	);
}

function onMessage({ data }) {
	if (data.statusUpdate) {
		({ isOnline, isLoggedIn } = data.statusUpdate); 
		console.log(`Service Worker (v${version}) status update, isOnline: ${isOnline}, isLoggedIn${isLoggedIn}`);
	
	}
}

//alle Anfragen der Webseite abfangen 
function onFetch(evt) {
	evt.respondWith(proxyRouter(evt.request)); //oder waitUntil
}

//Hauptfunktionalität Proxyfunktion 
async function proxyRouter(req) {
	var url = new URL(req.url);
	var reqURL = url.pathname;
	var cache = await caches.open(cacheName);

	//Caching Strategie: Server anfragen, GETs cachen, response vom Server an Client zurück, wenn fehlschlägt eigene 404 Ajax Antwort
	if (url.origin == location.origin) {	//Anfragen nur an unsere Webseite ohne zusätzliche Anfragen an Drittanbieter (Frameworks etc.)
		//API Anfragen handlen
		if (/^\/api\/.+$/.test(reqURL)) {  //get-posts
			let fetchOptions = {
				credentials: "same-origin",
				cache: "no-store"
			};
			let res = await safeRequest(reqURL,req,fetchOptions,/*cacheResponse=*/false,/*checkCacheFirst=*/false,/*checkCacheLast=*/true,/*useRequestDirectly=*/true);
			if (res) {
				if (req.method == "GET") {  				//SW cached nur GET requests, deswegen cacheResponse = false, 
					await cache.put(reqURL,res.clone());   //Antwort muss geklont werden wenn mehrfachverwendung aus dem Cache
				}
				return res;
			}

			return notFoundResponse();
		}
		// Wenn Navigation zu einer HTML Seite 
		else if (req.headers.get("Accept").includes("text/html")) {
			// eingeloggte Seiten handlen
			if (/^\/(?:login|logout|add-post)$/.test(reqURL)) {
				let res;
				
				//bei jeder Navigation, nach eingeloggt ausgeloggt offline online checken
				if (reqURL == "/login") {
					if (isOnline) {
						let fetchOptions = {
							method: req.method,
							headers: req.headers,
							credentials: "same-origin",
							cache: "no-store",
							redirect: "manual"  //SW übernimmt redirect
						};
						res = await safeRequest(reqURL,req,fetchOptions);  //Anfrage vom Server direkt nutzen sonst Cache checken
						//Server leitet automatisch von login zu add-post weiter, SW ahmt Verhalten nach
						if (res) {
							if (res.type == "opaqueredirect") {
								return Response.redirect("/add-post",307);
							}
							return res;
						}
						//wenn Serverantwort fehlschlägt und Online und eingeloggt -> zu /add-post
						if (isLoggedIn) {
							return Response.redirect("/add-post",307);
						}
						//wenn Online und nicht eingeloggt -> zu /login 
						res = await cache.match("/login");
						if (res) {
							return res;
						}
						//sonst -> zu Startseite
						return Response.redirect("/",307);
					}
					//offline aber eingeloggt (wahrscheinlich noch eingeloggt) -> zu /add-post
					else if (isLoggedIn) {
						return Response.redirect("/add-post",307);
					}
					//offline und nicht eingeloggt-> /login Seite aus dem Cache zurückgeben
					else {
						res = await cache.match("/login");
						if (res) {
							return res;
						}
						//Freundliche Error Seite
						return cache.match("/offline");
					}
				}
				else if (reqURL == "/logout") {
					if (isOnline) {
						let fetchOptions = {
							method: req.method,
							headers: req.headers,
							credentials: "same-origin",
							cache: "no-store",
							redirect: "manual"
						};
						res = await safeRequest(reqURL,req,fetchOptions);
						if (res) {
							if (res.type == "opaqueredirect") {
								return Response.redirect("/",307);
							}
							return res;
						}
						//wenn online und Serverantwort schlägt fehl, Nachricht an Webseite: ausloggen, cookies löschen und weiterleiten zu Startseite
						if (isLoggedIn) {
							isLoggedIn = false;
							await sendMessage("force-logout");
							await delay(100);
						}
						return Response.redirect("/",307);
					}
					//wenn offline gleiche Prozedur
					else if (isLoggedIn) {
						isLoggedIn = false;
						await sendMessage("force-logout");
						await delay(100);
						return Response.redirect("/",307);
					}
					//Offline und nicht eingeloggt -> zur Startseite
					else {
						return Response.redirect("/",307);
					}
				}
				//eingeloggt
				else if (reqURL == "/add-post") {
					if (isOnline) {
						let fetchOptions = {
							method: req.method,
							headers: req.headers,
							credentials: "same-origin",
							cache: "no-store"
						};
						res = await safeRequest(reqURL,req,fetchOptions,/*cacheResponse=*/true);
						if (res) {
							return res;
						}
						//wenn online und eingeloggt-> zu /add-post, wenn offline und ausgeloggt -> zu /login
						res = await cache.match(
							isLoggedIn ? "/add-post" : "/login"
						);
						if (res) {
							return res;
						}
						//nicht eingeloggt und nichts im Cache -> zu Startseite
						return Response.redirect("/",307);
					}
					//Offline und eingeloggt, wenn /add-post nicht im Cache, Offline Seite aus dem Cache zurückgeben
					else if (isLoggedIn) {
						res = await cache.match("/add-post");
						if (res) {
							return res;
						}
						return cache.match("/offline");
					}
					//ausgeloggt, login Seite aus dem Cache zurückgeben, sonst Offline Seite aus dem Cache
					else {
						res = await cache.match("/login");
						if (res) {
							return res;
						}
						return cache.match("/offline");
					}
				}
			}
			// "normale" HTML Seiten, /about und /contact
			else {
				let fetchOptions = {
					method: req.method,
					headers: req.headers,
					cache: "no-store"
				};
				let res = await safeRequest(reqURL,req,fetchOptions,/*cacheResponse=*/false,/*checkCacheFirst=*/false,/*checkCacheLast=*/true);
				if (res) {
					//Server fügt X-Not-Found zum Header hinzu wenn freundliche 404 gesendet wurde
					//SW informieren, dass Seite nicht gefunden wurde damit 404 Error Seite nicht nochmal gecached wird
					if (!res.headers.get("X-Not-Found")) { 
						await cache.put(reqURL,res.clone());
					}
					else {
						await cache.delete(reqURL);
					}
					return res;
				}
				//freundliche 404 Error Seite aus dem Cache
				return cache.match("/offline");
			}
		}
		// alle anderen Ressourcen direkt aus dem Cache nehmen
		else {
			let fetchOptions = {
				method: req.method,
				headers: req.headers,
				cache: "no-store"
			};
			let res = await safeRequest(reqURL,req,fetchOptions,/*cacheResponse=*/true,/*checkCacheFirst=*/true);
			if (res) {
				return res;
			}

			return notFoundResponse();
		}
	}
}
async function safeRequest(reqURL,req,options,cacheResponse = false,checkCacheFirst = false,checkCacheLast = false,useRequestDirectly = false) {
	var cache = await caches.open(cacheName);
	var res;

	if (checkCacheFirst) {
		res = await cache.match(reqURL);
		if (res) {
			return res;
		}
	}
	//
	if (isOnline) {
		try {
			if (useRequestDirectly) {
				res = await fetch(req,options); //req, weil man im POST Objekt nicht auf req.url zugreifen kann 
			}
			else {
				res = await fetch(req.url,options);  
			}
			//Bei Weiterleitung nicht cachen, deswegen auch auf Weiterleitung prüfen
			if (res && (res.ok || res.type == "opaqueredirect")) {  // Server leitet automatisch beim einloggen und ausloggen an /add-posts und Startseite weiter
				if (cacheResponse) {
					await cache.put(reqURL,res.clone());
				}
				return res;
			}
		}
		catch (err) {}
	}

	if (checkCacheLast) {
		res = await cache.match(reqURL);
		if (res) {
			return res;
		}
	}
}

async function onInstall(evt) {
	console.log(`Service Worker (${version}) installed... `);
	self.skipWaiting();  
}

function onActivate(evt) {
	evt.waitUntil(handleActivation()); 			//Browser informieren noch nicht alle Prozesse zu beenden bis alles gecached ist
	
}
//neuer SW
//Wenn neuer SW registriert ist, wird dieser nicht benutzt bis zum nächsten laden der Seite 
async function handleActivation() {
	await clearCaches(); 			 //da neuer SW lösche alte Caches
	await cacheLoggedOutFiles(/*forceReload=*/true);
	await clients.claim();    		//nutze neuen SW direkt und nicht bis zum nächsten laden der Seite
	console.log(`Service Worker (${version}) activated... `);
}



async function clearCaches() {
	var cacheNames = await caches.keys();
	var oldCacheNames  = cacheNames.filter(function matchOldCache(cacheName){
	if (/^unternehmen-\d+$/.test(cacheName)) {  //wenn alte Versionsnummer dann cachen
		let [,cacheVersion] = cacheName.match(/^unternehmen-(\d+)$/);
		cacheVersion = (cacheVersion != null) ? Number(cacheVersion) : cacheVersion;
		return (cacheVersion > 0 && cacheVersion != version) 
	}
	});
	return Promise.all(
		oldCacheNames.map(function deleteCache(cacheName){
			return caches.delete(cacheName);
		})
	)
}
//beim starten eies neuen SW wird periodisch gecached
async function cacheAllPosts(forceReload = false) {
	// cachen wir schon ?
	if (allPostsCaching) {
		return;
	}
	allPostsCaching = true;
	await delay(5000);  //5 Sekunden warten damit alles initialisiert wurde und Seite geladen

	var cache = await caches.open(cacheName);
	var postIDs;

	try {
		if (isOnline) {
			let fetchOptions = {
				method: "GET",
				cache: "no-store",
				credentials: "omit"
			};
			//GET Anfragen im Hintergrund um PostIDs zu bekommen 
			let res = await fetch("/api/get-posts",fetchOptions);
			if (res && res.ok) {
				await cache.put("/api/get-posts",res.clone());
				postIDs = await res.json();
			}
		}
		//wenn offline dann gecachte Version nutzen
		else {
			let res = await cache.match("/api/get-posts");
			if (res) {
				let resCopy = res.clone();
				postIDs = await res.json();
			}
			// caching noch nicht gestartet, wird später versucht
			else {
				allPostsCaching = false;
				return cacheAllPosts(forceReload);
			}
		}
	}
	catch (err) {
		console.error(err);
	}
	//neuste Posts zuerst cachen 
	if (postIDs && postIDs.length > 0) {
		return cachePost(postIDs.shift());
	}
	else {
		allPostsCaching = false;
	}
	//konstruiert URL von PostID und schaut ob Post schon gecached
	async function cachePost(postID) {
		var postURL = `/post/${postID}`;
		var needCaching = true;
	
		if (!forceReload) {
			let res = await cache.match(postURL);
			if (res) {
				needCaching = false;
			}
		}
		//post noch nicht gecached dann 10 Sekunden warten
		if (needCaching) {
			await delay(10000);
			if (isOnline) {
				try {
					let fetchOptions = {
						method: "GET",
						cache: "no-store",
						credentials: "omit"
					};
					let res = await fetch(postURL,fetchOptions);
					if (res && res.ok) {
						await cache.put(postURL,res.clone());
						needCaching = false;
					}
				}
				catch (err) {}
			}
	
			// cachen des Posts fehlgeschlagen, alle 10 Sekunden nochmal versuchen
			if (needCaching) {
				return cachePost(postID);
			}
		}
	
		// gibt es noch mehrere Post zum cachen ?
		if (postIDs.length > 0) {
			return cachePost(postIDs.shift());
		}
		else {
			allPostsCaching = false;
		}
	}
	}
	
async function cacheLoggedOutFiles(forceReload = false) {
	var cache = await caches.open(cacheName);
	
	return Promise.all(
		urlsToCache.loggedOut.map(async function requestFile(url){
			try {
				let res;
				//schauen ob schon gecached wurde (vielleicht Browser abgestürzt etc.) 
				if(!forceReload) { 
					res = await cache.match(url); 
					if (res) { 				
						return res;
						
					}  
				}

				let fetchOptions = {
					method: "GET",
					cache: "no-cache",  //wollen frische Egebnisse vom Server nicht vom Cache
					credentials: "omit" // ausgeloggte HMTL Seiten
				};
				res = await fetch(url, fetchOptions);
				if (res.ok) {
					await cache.put(url, res); 
				}
			}
			catch (err) {}
		})
	);
}

function notFoundResponse() {
	return new Response("",{
			status: 404,
			statusText: "Not Found"
		});
}

function delay(ms) {
	return new Promise(function c(res){
		setTimeout(res,ms);
	});
}
