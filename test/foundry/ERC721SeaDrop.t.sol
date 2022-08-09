// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "forge-std/Test.sol";

import { SeaDrop } from "seadrop/SeaDrop.sol";

import { ERC721SeaDrop } from "seadrop/ERC721SeaDrop.sol";

import { IERC721SeaDrop } from "seadrop/interfaces/IERC721SeaDrop.sol";

import { SeaDropErrorsAndEvents } from "seadrop/lib/SeaDropErrorsAndEvents.sol";

import { Conduit, PublicDrop } from "seadrop/lib/SeaDropStructs.sol";

contract ERC721DropTest is Test, SeaDropErrorsAndEvents {
    SeaDrop seadrop;
    ERC721SeaDrop test;
    mapping(address => uint256) privateKeys;
    mapping(bytes => address) seedAddresses;

    struct FuzzInputs {
        uint40 numMints;
        address minter;
        address feeRecipient;
    }

    modifier validateArgs(FuzzInputs memory args) {
        vm.assume(args.numMints > 0 && args.numMints <= 10);
        vm.assume(args.minter != address(0) && args.feeRecipient != address(0));
        vm.assume(
            args.feeRecipient.code.length == 0 && args.feeRecipient > address(9)
        );
        _;
    }

    function setUp() public {
        // Deploy SeaDrop.
        seadrop = new SeaDrop();

        // Deploy test ERC721SeaDrop.
        address[] memory allowedSeaDrop = new address[](1);
        allowedSeaDrop[0] = address(seadrop);
        test = new ERC721SeaDrop("", "", address(this), allowedSeaDrop);

        // Set maxSupply to 1000.
        test.setMaxSupply(1000);

        // Set creator payout address.
        address creator = address(0xABCD);
        test.updateCreatorPayoutAddress(address(seadrop), creator);

        // Create public drop object.
        PublicDrop memory publicDrop = PublicDrop(
            0.1 ether, // mint price
            uint64(block.timestamp), // start time
            10, // max mints per wallet
            100, // fee (1%)
            false // if false, allow any fee recipient
        );

        // Impersonate test erc721 contract.
        vm.prank(address(test));

        // Update the public drop for the erc721 contract.
        seadrop.updatePublicDrop(publicDrop);
    }

    function makeAddr(bytes memory seed) public returns (address) {
        uint256 pk = uint256(keccak256(seed));
        address derived = vm.addr(pk);
        seedAddresses[seed] = derived;
        privateKeys[derived] = pk;
        return derived;
    }

    function testMintPublic(FuzzInputs memory args) public validateArgs(args) {
        PublicDrop memory publicDrop = seadrop.getPublicDrop(address(test));

        uint256 mintValue = args.numMints * publicDrop.mintPrice;

        vm.deal(args.minter, 100 ether);
        vm.prank(args.minter);

        Conduit memory conduit = Conduit(address(0), bytes32(0));

        seadrop.mintPublic{ gas: 10000000000000000000, value: mintValue }(
            address(test),
            args.feeRecipient,
            args.numMints,
            conduit
        );

        assertEq(test.balanceOf(args.minter), args.numMints);
    }

    function testMintPublic_incorrectPayment(FuzzInputs memory args)
        public
        validateArgs(args)
    {
        PublicDrop memory publicDrop = seadrop.getPublicDrop(address(test));
        uint256 mintValue = args.numMints * publicDrop.mintPrice;

        vm.expectRevert(
            abi.encodeWithSelector(IncorrectPayment.selector, 1, mintValue)
        );

        vm.deal(args.minter, 100 ether);
        vm.prank(args.minter);

        Conduit memory conduit = Conduit(address(0), bytes32(0));

        seadrop.mintPublic{ value: 1 wei }(
            address(test),
            args.feeRecipient,
            args.numMints,
            conduit
        );
    }

    function testMintSeaDrop_revertNonSeaDrop(FuzzInputs memory args)
        public
        validateArgs(args)
    {
        PublicDrop memory publicDrop = seadrop.getPublicDrop(address(test));

        uint256 mintValue = args.numMints * publicDrop.mintPrice;

        vm.deal(args.minter, 100 ether);

        vm.expectRevert(IERC721SeaDrop.OnlySeaDrop.selector);

        test.mintSeaDrop{ value: mintValue }(args.minter, args.numMints);
    }
}
