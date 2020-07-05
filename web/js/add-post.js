(function AddPost(){
	"use strict";

	var titleInput;
	var postInput;
	var addPostBtn;

	document.addEventListener("DOMContentLoaded",ready,false);


	// **********************************

	async function ready() {
		titleInput = document.getElementById("new-title");
		postInput = document.getElementById("new-post");
		addPostBtn = document.getElementById("btn-add-post");

		addPostBtn.addEventListener("click",addPost,false);
		titleInput.addEventListener("change",backupPost,false);
		postInput.addEventListener("change",backupPost,false);

		// niccht abgesendeten Post wiederherstellen
		var addPostBackup = await idbKeyval.get("add-post-backup");
		if (addPostBackup) {
			titleInput.value = addPostBackup.title || "";
			postInput.value = addPostBackup.post || "";
		}
	}

	// geschriebener nicht abgesendeter Post in IndexDB speichern
	async function backupPost() {
		await idbKeyval.set("add-post-backup",{
			title: titleInput.value,
			post: postInput.value
		});
	}

	async function addPost() {
		if (
			titleInput.value.length > 0 &&
			postInput.value.length > 0
		) {
			// offline posten nicht möglich
			if (!isSiteOnline()) {
				alert("Es sieht so aus als ob Sie Offline sind. Versuchen Sie zu posten wenn Sie Online sind.");
				return;
			}

			try {
				let res = await fetch("/api/add-post",{
					method: "POST",
					credentials: "same-origin",
					body: JSON.stringify({
						title: titleInput.value,
						post: postInput.value
					})
				});

				if (res && res.ok) {
					let result = await res.json();
					if (result.OK) {
						titleInput.value = "";
						postInput.value = "";
						document.location.href = `/post/${result.postID}`;
						return;
					}
				}
			}
			catch (err) {
				console.error(err);
			}

			alert("Posten fehlgeschlagen. Bitte versuchen Sie es erneut.");
		}
		else {
			alert("Geben Sie bitte einen Titel und einen Text ein.");
		}
	}

})();
